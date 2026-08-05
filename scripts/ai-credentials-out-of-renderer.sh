#!/usr/bin/env bash
# Prove cloud BYOK credentials stay out of the renderer for API use:
# presence-only hydration + Tauri cloud_ai_proxy (secret headers stripped on IPC).
# Does not claim the full AI DoD box — OAuth / live evals remain open.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm -C apps/desktop exec vitest run \
  src/lib/cloudAiCredentials.test.ts \
  src/lib/geminiAssistant.test.ts \
  --reporter=dot
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml credentials::tests -- --nocapture
echo "AI-CREDENTIALS-OUT-OF-RENDERER: ok"
