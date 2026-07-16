#!/usr/bin/env bash
# Cursor stop / subagentStop → keep the Tau desktop window on the latest tree.
# Reads (and ignores) hook JSON on stdin; always exits 0 so a refresh failure
# never blocks the agent loop.
set -uo pipefail
# Drain stdin so the hook runner never blocks on an unread pipe.
cat >/dev/null || true
root="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$root/scripts/refresh-tau-app.sh"
