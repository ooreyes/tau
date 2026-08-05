#!/usr/bin/env bash
# Prove versioned CLI/API with machine-readable diagnostics (product-gates DoD partial).
# Does NOT claim the full student/pro/dev product-gates box (learning path still open).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pnpm -C apps/desktop exec vitest run \
  src/cli/tauCliApi.test.ts \
  src/cli/runTauCli.test.ts \
  --reporter=dot

# Live CLI smoke: diagnose the corpus voltage divider, require JSON ok envelope.
JSON_OUT="$(node scripts/tau-cli.mjs diagnose --json Circuit_testing_v1/01_op_voltage_divider.asc)"
echo "$JSON_OUT" | node -e '
  const fs = require("fs");
  const raw = fs.readFileSync(0, "utf8");
  const j = JSON.parse(raw);
  if (j.kind !== "tau.cli.diagnose.v1") throw new Error("bad kind: " + j.kind);
  if (j.apiVersion !== "tau.cli.v1") throw new Error("bad apiVersion: " + j.apiVersion);
  if (j.status !== "ok") throw new Error("expected ok, got " + j.status);
  if (j.exitCode !== 0) throw new Error("expected exitCode 0");
  if (!j.stages?.deck?.ok) throw new Error("deck not ok");
  if (!Array.isArray(j.diagnostics)) throw new Error("diagnostics missing");
  console.log("PRODUCT-GATES-CLI-API: ok (diagnose live)");
'

# Usage failure must be exit 64.
set +e
node scripts/tau-cli.mjs diagnose >/dev/null 2>&1
code=$?
set -e
if [[ "$code" -ne 64 ]]; then
  echo "expected usage exit 64, got $code" >&2
  exit 1
fi

echo "PRODUCT-GATES-CLI-API: ok"
