#!/usr/bin/env bash
# Named-device fidelity slice: refuse-vs-exact proof. Stdout is truth.
# Does NOT claim the AGENTS ≥95% unencrypted-corpus floor.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SPEC="scripts/namedDeviceFidelity.corpus.ts"
[[ -f "$ROOT/apps/desktop/$SPEC" ]] || {
  echo "Named-device fidelity proof is missing apps/desktop/$SPEC" >&2
  exit 1
}

exec pnpm -C apps/desktop exec vitest run \
  --config vitest.corpus.config.ts \
  "$SPEC"
