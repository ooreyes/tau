#!/usr/bin/env bash
# Acceptance-corpus runner.
#
# Recursively imports every `.asc` in the user's own LTspice corpus
# (~/Downloads/LTspice_export and ~/Documents/LTspice),
# builds an `.op` deck for each, runs it through Tau's isolated native worker
# and bundled ngspice/code models, and reports
# warning-clean / deck-built / op-converged counts. Fails if any count drops
# below the truthful ≥80/82 release floor. Unsupported devices are reported as
# explicit refusals rather than being silently dropped or approximated.
#
# Usage:
#   scripts/acceptance-corpus.sh                 # all discovered user files
#   CORPUS_SKIP_NGSPICE=1 scripts/acceptance-corpus.sh   # import+deck only
#   CORPUS_CANONICAL_ONLY=1 scripts/acceptance-corpus.sh # historical 82 only
#   CORPUS_EXTRA_ROOTS=/path/to/LTspicePowerSim-main scripts/acceptance-corpus.sh
#     # recursively adds external ASC trees; each <root>/sym is searched for
#     # matching .asy/.asc hierarchy without copying third-party assets to Tau
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --quiet --manifest-path apps/desktop/src-tauri/Cargo.toml --bin tau
exec pnpm -C apps/desktop exec vitest run --config vitest.corpus.config.ts scripts/acceptanceCorpus.corpus.ts "$@"
