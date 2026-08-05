#!/usr/bin/env bash
# Named-device fidelity:
#   1) refuse-vs-exact unit proof (synthetic fixtures)
#   2) recursive unencrypted exact-model % (user corpus; stdout is truth)
#
# Does NOT claim the AGENTS ≥95% floor — only a measured
# NAMED-DEVICE-RECURSIVE exact-rate≥95% with silent=0 and hard-failure=0 may.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

UNIT="scripts/namedDeviceFidelity.corpus.ts"
RECURSIVE="scripts/namedDeviceRecursive.corpus.ts"
for spec in "$UNIT" "$RECURSIVE"; do
  [[ -f "$ROOT/apps/desktop/$spec" ]] || {
    echo "Named-device fidelity proof is missing apps/desktop/$spec" >&2
    exit 1
  }
done

exec pnpm -C apps/desktop exec vitest run \
  --config vitest.corpus.config.ts \
  --reporter=verbose \
  "$UNIT" \
  "$RECURSIVE"
