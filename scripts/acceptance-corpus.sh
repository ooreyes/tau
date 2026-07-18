#!/usr/bin/env bash
# Acceptance-corpus runner (AGENTS.md → Definition of Done).
#
# Imports every `.asc` in the user's own LTspice corpus
# (~/Downloads/LTspice_export, ~/Documents/LTspice, …/examples/Educational),
# builds an `.op` ngspice deck for each, batch-runs it, and reports
# warning-clean / deck-built / op-converged counts. Fails if any count drops
# below the recorded baseline.
#
# Usage:
#   scripts/acceptance-corpus.sh                 # canonical 82-file corpus
#   CORPUS_SKIP_NGSPICE=1 scripts/acceptance-corpus.sh   # import+deck only
#   CORPUS_ALL=1 scripts/acceptance-corpus.sh    # + full examples tree (slow)
#   CORPUS_EXTRA_ROOTS=/path/to/LTspicePowerSim-main scripts/acceptance-corpus.sh
#     # recursively adds external ASC trees; each <root>/sym is searched for
#     # matching .asy/.asc hierarchy without copying third-party assets to Tau
set -euo pipefail
cd "$(dirname "$0")/.."
exec pnpm -C apps/desktop exec vitest run --config vitest.corpus.config.ts "$@"
