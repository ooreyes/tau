#!/usr/bin/env bash
# Keep the native Tau window on the latest tree after agent work.
#
# - Ensures Vite is serving the live frontend on :1420
# - Ensures a `tauri dev` CLI is attached to that server (HMR + Rust watch)
# - Touches a Vite-watched stamp so the open webview does a full reload
# - Brings the Tau window forward on macOS
#
# Safe to call from Cursor / Claude Code stop hooks. Debounced. Never fails
# the hook (exit 0) — refresh is best-effort.
set -uo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0

stamp="$root/apps/desktop/.agent-reload"
log_dir="${TMPDIR:-/tmp}"
log="$log_dir/tau-refresh.log"
lock="$log_dir/tau-refresh.lock"
debounce_seconds=20
port=1420
desktop="$root/apps/desktop"

mkdir -p "$(dirname "$stamp")" 2>/dev/null || true

log_line() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$log" 2>/dev/null || true
}

# Debounce rapid stop/subagentStop storms from multitask sessions.
if [[ -f "$lock" ]]; then
  now="$(date +%s)"
  last="$(stat -f %m "$lock" 2>/dev/null || echo 0)"
  if (( now - last < debounce_seconds )); then
    log_line "skip (debounced ${debounce_seconds}s)"
    exit 0
  fi
fi
date +%s >"$lock" 2>/dev/null || true

port_in_use() {
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

# Only a live `tauri dev` CLI gets HMR. An orphaned Tau.app from a prior
# `tauri build` / crashed session does NOT — those bake the frontend in.
process_is_in_tau_tree() {
  local pid cwd
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    if [[ "$cwd" == "$root" || "$cwd" == "$root/"* ]]; then
      return 0
    fi
  done
  return 1
}

tauri_dev_cli_running() {
  {
    pgrep -f '(@tauri-apps/cli|tauri\.js)[[:space:]].*dev' 2>/dev/null || true
    pgrep -f 'pnpm([[:space:]]+exec)?[[:space:]]+tauri[[:space:]]+dev' 2>/dev/null || true
    pgrep -f 'cargo-tauri' 2>/dev/null || true
  } | sort -u | process_is_in_tau_tree
}

vite_for_tau_running() {
  pgrep -fl '[v]ite' 2>/dev/null | grep -F "$root" >/dev/null 2>&1
}

# Quit orphaned debug-bundle Tau windows from this checkout so the user isn't
# left staring at a stale baked UI while a fresh tauri-dev launches.
quit_stale_debug_tau() {
  local pids
  pids="$(pgrep -f "$root/apps/desktop/src-tauri/target/debug/.*/Tau\.app/Contents/MacOS/tau" 2>/dev/null || true)"
  [[ -z "$pids" ]] && return 0
  if tauri_dev_cli_running; then
    return 0
  fi
  log_line "quitting stale debug Tau.app (pids: $pids)"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
}

# Spawn a grandchild in a new session so Cursor/Claude shell teardown cannot
# reap the live Vite / tauri-dev processes with the hook's process group.
detach_exec() {
  local workdir="$1"
  shift
  /usr/bin/python3 - "$workdir" "$log" "$@" <<'PY'
import os, sys, subprocess
workdir, log_path, *cmd = sys.argv[1:]
if os.fork() != 0:
    sys.exit(0)
os.setsid()
if os.fork() != 0:
    sys.exit(0)
os.chdir(workdir)
os.environ["PATH"] = os.environ.get("PATH", "")
with open(log_path, "a", encoding="utf-8") as log:
    os.dup2(log.fileno(), 1)
    os.dup2(log.fileno(), 2)
os.closerange(3, 32)
os.execvp(cmd[0], cmd)
PY
}

start_vite() {
  log_line "starting Vite on :$port"
  detach_exec "$root" pnpm --filter @tau/desktop dev
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
    port_in_use && return 0
    sleep 0.5
  done
  log_line "Vite did not bind :$port in time"
  return 1
}

start_tauri_dev() {
  # Attach to the already-running Vite — clear beforeDevCommand so we don't
  # fight over :1420 (this Tauri CLI's --no-dev-server flag only disables the
  # static fallback server, not beforeDevCommand).
  log_line "starting tauri dev attached to live Vite"
  detach_exec "$desktop" pnpm exec tauri dev --no-dev-server-wait \
    -c '{"build":{"beforeDevCommand":""}}'
  sleep 3
}

force_frontend_reload() {
  date -u +%Y-%m-%dT%H:%M:%SZ >"$stamp" 2>/dev/null || true
  log_line "touched $stamp"
}

activate_tau_window() {
  osascript >/dev/null 2>&1 <<'APPLESCRIPT' || true
tell application "System Events"
  set candidates to (every process whose name is "tau" or name is "Tau")
  if (count of candidates) > 0 then
    set frontmost of item 1 of candidates to true
  end if
end tell
APPLESCRIPT
}

# ── main ───────────────────────────────────────────────────────────────
log_line "refresh start (cwd=$root)"

if ! port_in_use; then
  start_vite || exit 0
elif ! vite_for_tau_running && ! tauri_dev_cli_running; then
  log_line "port $port busy by a non-Tau process — leaving alone"
  exit 0
fi

if tauri_dev_cli_running; then
  log_line "live tauri-dev detected — reload only"
else
  quit_stale_debug_tau
  log_line "no live tauri-dev — launching against Vite"
  start_tauri_dev
fi

force_frontend_reload
activate_tau_window
log_line "refresh done"
exit 0
