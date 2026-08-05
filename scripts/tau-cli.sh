#!/usr/bin/env bash
# Versioned Tau CLI (`tau.cli.v1`) — thin wrapper around scripts/tau-cli.mjs.
# Does NOT claim the full student/pro/dev product-gates box.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec node scripts/tau-cli.mjs "$@"
