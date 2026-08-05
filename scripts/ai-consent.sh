#!/usr/bin/env bash
# Prove explicit cloud-data consent is fail-closed before circuit context leaves
# the machine (Gemini / Anthropic BYOK). Not Tau OAuth.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm -C apps/desktop exec vitest run \
  src/lib/geminiAssistant.test.ts \
  src/components/AssistantPanel.test.tsx \
  src/components/SettingsPanel.test.tsx \
  --reporter=dot
echo "AI-CONSENT: ok"
