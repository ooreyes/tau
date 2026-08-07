# CLAUDE.md

> **The autonomous build contract lives in [AGENTS.md](AGENTS.md). Read it first.**
> It defines the work loop, the durability/commit rules, the heartbeat protocol,
> and the Definition of Done. This file is intentionally a pointer so the two
> never drift.

Quick orientation for an interactive session:

- **Canonical branch:** `auto/ltspice-parity` (a superset of all prior work).
- **Current priority mission:** the ordered completion criteria under
  **"THE NEW BAR"** in the autobuilder's driver
  (`~/.tau-autobuilder/prompt.md`, section `AUDIT 2026-08-04`) — correctness and
  legality first (license/attribution, no silent model substitution), then
  capability. That file is what the autonomous bot reads; this doc is for
  interactive sessions. (The older "§11 simulator UX + measurements, 2026-07-10"
  mission was superseded by the 2026-08-04 audit rewrite; the prompt no longer
  has a §11.)
- **To‑do list:** [FEATURE_PARITY.md](FEATURE_PARITY.md) — pick the next item.
- **Live status + heartbeat:** top of [PROGRESS.md](PROGRESS.md) — shows the
  active unit and whether the last run finished or died mid‑change.
- **How we know it's done:** the Definition of Done checklist in `AGENTS.md`.

```bash
pnpm install                       # from repo root
pnpm -C apps/desktop typecheck
pnpm -C apps/desktop test
pnpm dev                           # Tauri desktop app (native window)
```

License is intentionally proprietary‑for‑now; do not add an OSS license file.
