#!/usr/bin/env python3
"""Tau overnight orchestrator via the Cursor Python SDK (`cursor-sdk`).

Loops for N hours (default 8) or N units, launching a **local** Cursor agent
against this repo on each unit. Priorities track AGENTS.md Definition of Done:
named-device hard-failures / exact %, broad differential parity, student AI
seamlessness, and Apple-light §10 UI.

Setup:
  pip install cursor-sdk
  export CURSOR_API_KEY="cursor_..."   # https://cursor.com/dashboard/api
  python scripts/tau_overnight_sdk.py

Optional:
  python scripts/tau_overnight_sdk.py --hours 8 --units 12 --resume
  python scripts/tau_overnight_sdk.py --list-models
  TAU_OVERNIGHT_RESUME=1 python scripts/tau_overnight_sdk.py

State (last agent_id) defaults to ~/.tau-overnight-sdk-state.json.
Morning summary appends to ~/Desktop/TAU-MORNING-STATUS.md.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths / defaults
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATE = Path.home() / ".tau-overnight-sdk-state.json"
DEFAULT_STATUS = Path.home() / "Desktop" / "TAU-MORNING-STATUS.md"
DEFAULT_MODEL = "composer-2.5"
DEFAULT_HOURS = 8.0
DEFAULT_UNITS = 0  # 0 = unlimited until hours elapse

UNIT_PROMPT = """You are an autonomous Tau builder on branch `auto/ltspice-parity`.

Read first (do not dump whole files):
1. AGENTS.md — Definition of Done + durability/commit rules
2. Top of PROGRESS.md — heartbeat; finish or revert any dead IN PROGRESS unit
3. Active unchecked items in FEATURE_PARITY.md / open DoD boxes in AGENTS.md

Claim ONE small, finishable unit. Prefer highest-leverage DoD work, in order:
1. Named-device fidelity — drive recursive hard-failure toward 0 and raise
   unencrypted exact-model % (silent must stay 0; do not weaken honest refusals)
2. Broad differential parity — close remaining gaps vs LTspice
   (`scripts/differential-parity.sh` / differentialParity.corpus.ts)
3. Student / AI path — seamless first-success learning + production-safe
   circuit-aware AI (no cookie reuse; credentials out of renderer)
4. Apple-light §10 UI — design-token / shadcn migration; light, paid-product feel;
   usable at the app's minimum window size

Rules:
- Work test-first where practical; verify native path for engine changes.
- Never fake models, simulation, cancellation, or AI. Fail closed.
- Commit + push continuously on `auto/ltspice-parity` with messages ending in
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Update FEATURE_PARITY.md + PROGRESS.md heartbeat (claim → DONE) for the unit.
- Gates before push: `pnpm -C apps/desktop typecheck` and `pnpm -C apps/desktop test`.
- Stop after one unit. Summarize: what landed, files, tests, next step.
"""


def _now_local() -> datetime:
    return datetime.now().astimezone()


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now_local()).isoformat(timespec="seconds")


def _log(msg: str) -> None:
    print(f"[{_iso()}] {msg}", flush=True)


def load_state(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        _log(f"warning: could not read state {path}: {exc}")
        return {}


def save_state(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def append_status(path: Path, block: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header_needed = not path.is_file()
    with path.open("a", encoding="utf-8") as fh:
        if header_needed:
            fh.write("# Tau morning status (overnight SDK)\n\n")
            fh.write(
                "Appended by `scripts/tau_overnight_sdk.py`. "
                "Each unit is one local Cursor SDK agent run.\n\n"
            )
        fh.write(block)
        if not block.endswith("\n"):
            fh.write("\n")


def require_api_key() -> str:
    key = (os.environ.get("CURSOR_API_KEY") or "").strip()
    if not key:
        print(
            "CURSOR_API_KEY is not set.\n\n"
            "  pip install cursor-sdk\n"
            "  export CURSOR_API_KEY=\"cursor_...\"  # Cursor Dashboard → API Keys\n"
            "  python scripts/tau_overnight_sdk.py\n",
            file=sys.stderr,
        )
        sys.exit(1)
    return key


def resolve_model(api_key: str, requested: str) -> str:
    """Prefer requested id; if listing works and it's missing, fall back wisely."""
    try:
        from cursor_sdk import Cursor
    except ImportError:
        _log("cursor-sdk not importable yet; using requested model id as-is")
        return requested

    try:
        models = Cursor.models.list(api_key=api_key)
    except Exception as exc:  # noqa: BLE001 — listing is best-effort
        _log(f"model list unavailable ({exc}); using {requested!r}")
        return requested

    items = getattr(models, "items", None) or models
    ids: list[str] = []
    for m in items:
        mid = getattr(m, "id", None) or (m.get("id") if isinstance(m, dict) else None)
        if isinstance(mid, str) and mid:
            ids.append(mid)

    if not ids:
        return requested
    if requested in ids:
        return requested
    if DEFAULT_MODEL in ids:
        _log(f"model {requested!r} not in account list; falling back to {DEFAULT_MODEL!r}")
        return DEFAULT_MODEL
    _log(f"model {requested!r} not listed; using first available {ids[0]!r}")
    return ids[0]


def list_models(api_key: str) -> int:
    try:
        from cursor_sdk import Cursor
    except ImportError:
        print("Install first: pip install cursor-sdk", file=sys.stderr)
        return 1
    models = Cursor.models.list(api_key=api_key)
    items = getattr(models, "items", None) or models
    for m in items:
        mid = getattr(m, "id", None) or (m.get("id") if isinstance(m, dict) else "?")
        print(mid)
    return 0


def run_unit(
    *,
    cwd: Path,
    api_key: str,
    model: str,
    resume_id: str | None,
    prompt: str,
) -> dict[str, Any]:
    """Create or resume a local agent, send one unit prompt, wait, dispose."""
    from cursor_sdk import Agent, AgentOptions, CursorAgentError, LocalAgentOptions

    record: dict[str, Any] = {
        "started_at": _iso(),
        "agent_id": None,
        "run_id": None,
        "status": "unknown",
        "result_excerpt": None,
        "error": None,
        "error_kind": None,
        "resumed": bool(resume_id),
    }

    try:
        if resume_id:
            _log(f"resuming agent_id={resume_id}")
            cm = Agent.resume(
                resume_id,
                AgentOptions(
                    api_key=api_key,
                    model=model,
                    local=LocalAgentOptions(cwd=str(cwd)),
                ),
            )
        else:
            _log(f"creating local agent model={model!r} cwd={cwd}")
            cm = Agent.create(
                model=model,
                api_key=api_key,
                local=LocalAgentOptions(cwd=str(cwd)),
            )

        with cm as agent:
            agent_id = getattr(agent, "agent_id", None)
            record["agent_id"] = agent_id
            _log(f"agent_id={agent_id}")

            run = agent.send(prompt)
            run_id = getattr(run, "id", None)
            record["run_id"] = run_id
            _log(f"run.id={run_id}")

            result = run.wait()
            status = getattr(result, "status", None)
            record["status"] = status
            text = getattr(result, "result", None)
            if isinstance(text, str):
                record["result_excerpt"] = text[:2000]
            elif text is not None:
                record["result_excerpt"] = str(text)[:2000]

            if status == "error":
                # Run executed and failed — distinct from CursorAgentError.
                record["error_kind"] = "run_error"
                record["error"] = f"result.status==error run.id={run_id}"
                _log(f"run failed: {run_id}")
            else:
                _log(f"run finished: status={status} run.id={run_id}")

    except CursorAgentError as err:
        # Startup / auth / config / network — run never executed.
        record["status"] = "startup_error"
        record["error_kind"] = "CursorAgentError"
        record["error"] = getattr(err, "message", None) or str(err)
        retryable = getattr(err, "is_retryable", None)
        retry_after = getattr(err, "retry_after", None)
        record["is_retryable"] = retryable
        record["retry_after"] = str(retry_after) if retry_after is not None else None
        _log(
            f"startup failed: {record['error']} "
            f"retryable={retryable} retry_after={retry_after}"
        )
    except Exception as exc:  # noqa: BLE001
        record["status"] = "exception"
        record["error_kind"] = type(exc).__name__
        record["error"] = str(exc)
        record["traceback"] = traceback.format_exc()
        _log(f"unexpected exception: {exc}")

    record["finished_at"] = _iso()
    return record


def format_status_block(unit_index: int, record: dict[str, Any]) -> str:
    lines = [
        f"## Unit {unit_index} — {_iso()}",
        "",
        f"- status: `{record.get('status')}`",
        f"- agent_id: `{record.get('agent_id')}`",
        f"- run.id: `{record.get('run_id')}`",
        f"- resumed: `{record.get('resumed')}`",
        f"- started: `{record.get('started_at')}`",
        f"- finished: `{record.get('finished_at')}`",
    ]
    if record.get("error"):
        lines.append(f"- error_kind: `{record.get('error_kind')}`")
        lines.append(f"- error: {record['error']}")
    excerpt = record.get("result_excerpt")
    if excerpt:
        lines.extend(["", "### Result excerpt", "", "```", excerpt, "```"])
    lines.append("")
    return "\n".join(lines) + "\n"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Overnight Tau builder via Cursor Python SDK (local agents).",
    )
    p.add_argument(
        "--hours",
        type=float,
        default=float(os.environ.get("TAU_OVERNIGHT_HOURS", DEFAULT_HOURS)),
        help=f"wall-clock budget in hours (default {DEFAULT_HOURS})",
    )
    p.add_argument(
        "--units",
        type=int,
        default=int(os.environ.get("TAU_OVERNIGHT_UNITS", DEFAULT_UNITS)),
        help="max units (0 = until hours elapse)",
    )
    p.add_argument(
        "--cwd",
        type=Path,
        default=REPO_ROOT,
        help="Tau repo path for LocalAgentOptions(cwd=...)",
    )
    p.add_argument(
        "--model",
        default=os.environ.get("TAU_OVERNIGHT_MODEL", DEFAULT_MODEL),
        help=f"model id (default {DEFAULT_MODEL}; required for local)",
    )
    p.add_argument(
        "--resume",
        action="store_true",
        default=os.environ.get("TAU_OVERNIGHT_RESUME", "").lower() in ("1", "true", "yes"),
        help="resume last agent_id from the state file between units",
    )
    p.add_argument(
        "--no-resume",
        action="store_true",
        help="force fresh Agent.create each unit (overrides --resume / env)",
    )
    p.add_argument(
        "--state-file",
        type=Path,
        default=Path(os.environ.get("TAU_OVERNIGHT_STATE", str(DEFAULT_STATE))),
        help=f"JSON state path (default {DEFAULT_STATE})",
    )
    p.add_argument(
        "--status-file",
        type=Path,
        default=Path(os.environ.get("TAU_OVERNIGHT_STATUS", str(DEFAULT_STATUS))),
        help=f"morning summary markdown (default {DEFAULT_STATUS})",
    )
    p.add_argument(
        "--list-models",
        action="store_true",
        help="print Cursor.models.list() ids and exit",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="print config + prompt and exit without calling the SDK",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    cwd = args.cwd.resolve()
    if not (cwd / "AGENTS.md").is_file():
        print(f"error: {cwd} does not look like the Tau repo (missing AGENTS.md)", file=sys.stderr)
        return 1

    if args.dry_run:
        print(f"cwd={cwd}")
        print(f"hours={args.hours} units={args.units} model={args.model}")
        print(f"resume={args.resume and not args.no_resume}")
        print(f"state={args.state_file}")
        print(f"status={args.status_file}")
        print("--- prompt ---")
        print(UNIT_PROMPT)
        return 0

    api_key = require_api_key()

    if args.list_models:
        return list_models(api_key)

    try:
        import cursor_sdk  # noqa: F401
    except ImportError:
        print(
            "cursor-sdk is not installed.\n\n"
            "  pip install cursor-sdk\n"
            "  export CURSOR_API_KEY=\"cursor_...\"\n"
            "  python scripts/tau_overnight_sdk.py\n",
            file=sys.stderr,
        )
        return 1

    model = resolve_model(api_key, args.model)
    use_resume = bool(args.resume) and not args.no_resume
    deadline = _now_local() + timedelta(hours=args.hours)
    max_units = args.units if args.units > 0 else None

    _log(
        f"overnight start cwd={cwd} model={model!r} hours={args.hours} "
        f"units={max_units or '∞'} resume={use_resume} deadline={_iso(deadline)}"
    )
    append_status(
        args.status_file,
        f"# Overnight session {_iso()}\n\n"
        f"- cwd: `{cwd}`\n"
        f"- model: `{model}`\n"
        f"- hours: `{args.hours}` units_cap: `{max_units or 'none'}`\n"
        f"- resume: `{use_resume}`\n"
        f"- deadline: `{_iso(deadline)}`\n\n",
    )

    state = load_state(args.state_file)
    unit_index = 0
    exit_code = 0

    while True:
        now = _now_local()
        if now >= deadline:
            _log("hours budget exhausted; stopping")
            break
        if max_units is not None and unit_index >= max_units:
            _log("unit budget exhausted; stopping")
            break

        unit_index += 1
        resume_id = None
        if use_resume:
            resume_id = state.get("agent_id")
            if resume_id:
                _log(f"unit {unit_index}: will resume {resume_id}")
            else:
                _log(f"unit {unit_index}: no prior agent_id; creating fresh")

        record = run_unit(
            cwd=cwd,
            api_key=api_key,
            model=model,
            resume_id=resume_id if use_resume else None,
            prompt=UNIT_PROMPT,
        )
        append_status(args.status_file, format_status_block(unit_index, record))

        if record.get("agent_id"):
            state = {
                "agent_id": record["agent_id"],
                "last_run_id": record.get("run_id"),
                "last_status": record.get("status"),
                "updated_at": _iso(),
                "unit_index": unit_index,
            }
            save_state(args.state_file, state)

        status = record.get("status")
        if record.get("error_kind") == "CursorAgentError":
            exit_code = 1
            retryable = record.get("is_retryable")
            if not retryable:
                _log("non-retryable CursorAgentError; aborting overnight loop")
                break
            # Honor retry_after when present; otherwise brief backoff.
            delay = 30.0
            ra = record.get("retry_after")
            if ra:
                try:
                    delay = max(delay, float(ra))
                except (TypeError, ValueError):
                    pass
            _log(f"retryable startup error; sleeping {delay:.0f}s")
            time.sleep(delay)
            continue

        if status == "error":
            exit_code = 2
            # Continue overnight — one failed unit should not kill the budget.
            _log("unit run error recorded; continuing to next unit")

        # Small pause between units so commits/hooks settle.
        if now + timedelta(seconds=5) < deadline:
            time.sleep(5)

    try:
        from cursor_sdk import close_default_client

        close_default_client()
    except Exception:  # noqa: BLE001
        pass

    append_status(
        args.status_file,
        f"## Session end {_iso()}\n\n"
        f"- units_run: `{unit_index}`\n"
        f"- exit_code_hint: `{exit_code}` "
        f"(1=CursorAgentError, 2=run error seen, 0=clean finishes)\n"
        f"- last_agent_id: `{state.get('agent_id')}`\n\n---\n\n",
    )
    _log(f"overnight done units={unit_index} status_file={args.status_file}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
