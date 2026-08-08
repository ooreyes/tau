#!/usr/bin/env bash
# §10 design-system drift gate — machine-checkable evidence that the token /
# shadcn layer stays adopted. Does NOT flip AGENTS.md §10 by itself; humans /
# the autobuilder only check that box when this script is green AND the
# FEATURE_PARITY §10 remaining-debt list is empty (screenshot + Cupertino
# chrome settlement included).
#
# Checks:
#   1. Zero native <select> in app tsx (ui/Select only)
#   2. Hex colors only in App.css token blocks + documented allowlist
#   3. Resizable / Command / Toast primitives exist and are consumed
#   4. Focused primitive + Select migration unit tests green
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SRC="apps/desktop/src"
FAIL=0

note() { printf '%s\n' "$*"; }
fail() { note "FAIL: $*"; FAIL=1; }
pass() { note "PASS: $*"; }

# ── 0. A search tool that is missing must not read as a clean result ───────
# Every scan below is `$(... || true)`, so an absent `rg` returned nothing and
# checks 1 and 2 reported PASS without having looked at a single file — the
# gate said the tokens were clean because it could not search, which is worse
# than not running it. ripgrep stays preferred; grep is the fallback; neither
# is a hard stop. Patterns are written in the syntax both engines share
# (POSIX classes, `\b`, bounded repeats).
if command -v rg >/dev/null 2>&1; then
  SEARCH=rg
elif command -v grep >/dev/null 2>&1; then
  SEARCH=grep
  note "note: ripgrep not found; scanning with grep."
else
  note "FAIL: neither rg nor grep is on PATH, so this gate cannot verify anything."
  exit 1
fi

# Scan app sources of the given extensions, tests excluded.
scan_src() {
  local pattern="$1"
  shift
  local ext
  if [[ "$SEARCH" == rg ]]; then
    local globs=()
    for ext in "$@"; do globs+=(--glob "*.$ext"); done
    rg -n "$pattern" "$SRC" "${globs[@]}" --glob '!**/*.test.ts' --glob '!**/*.test.tsx' || true
  else
    local includes=()
    for ext in "$@"; do includes+=(--include "*.$ext"); done
    grep -rnE "$pattern" "$SRC" "${includes[@]}" | grep -vE '\.test\.(ts|tsx):' || true
  fi
}

# Scan one file.
scan_file() {
  if [[ "$SEARCH" == rg ]]; then
    rg -n "$1" "$2" || true
  else
    grep -nE "$1" "$2" || true
  fi
}

# Whether a file contains an import, quietly.
has_match() {
  if [[ "$SEARCH" == rg ]]; then
    rg -q "$1" "$2"
  else
    grep -qE "$1" "$2"
  fi
}

# ── 1. Native <select> ─────────────────────────────────────────────────────
SELECT_HITS="$(scan_src '<select[[:space:]>]' tsx)"
if [[ -n "$SELECT_HITS" ]]; then
  fail "native <select> remain in app tsx:"
  note "$SELECT_HITS"
else
  pass "zero native <select> in app tsx"
fi

# ── 2. Hex color gate ──────────────────────────────────────────────────────
# Allow: App.css token definition zones (:root, prefers-color-scheme, data-theme)
# plus documented non-UI sentinels / SVG plan previews / CSS color helper fallback.
HEX_RAW="$(scan_src '#[0-9a-fA-F]{3,8}\b' ts tsx css)"

HEX_CSS_LATE="$(scan_file '#[0-9a-fA-F]{3,8}\b' "$SRC/App.css" | awk -F: '$1+0 > 567' || true)"
if [[ -n "$HEX_CSS_LATE" ]]; then
  fail "App.css hex outside token zone (lines >567):"
  note "$HEX_CSS_LATE"
else
  pass "App.css hex confined to token zone (≤567)"
fi

HEX_TS="$(printf '%s\n' "$HEX_RAW" \
  | grep -E '\.(ts|tsx):' \
  | grep -vE 'SimulationPanel\.tsx|cssColor\.ts|assistantCircuitPlan\.ts|plotPng\.ts|\.test\.' || true)"
if [[ -n "$HEX_TS" ]]; then
  fail "hardcoded hex outside allowlist in ts/tsx:"
  note "$HEX_TS"
else
  pass "ts/tsx hex allowlist clean (probe/cssColor/plan SVG only)"
fi

# ── 3. Deferred primitives adopted ─────────────────────────────────────────
for f in command.tsx sonner.tsx resizable.tsx; do
  if [[ -f "$SRC/components/ui/$f" ]]; then
    pass "ui/$f present"
  else
    fail "missing ui/$f"
  fi
done

has_match 'from "@/components/ui/command"|from '\''@/components/ui/command'\''' "$SRC/components/CommandPalette.tsx" \
  && pass "CommandPalette consumes ui/command" \
  || fail "CommandPalette does not import ui/command"

has_match 'from "\./components/ui/sonner"|from "@/components/ui/sonner"' "$SRC/App.tsx" \
  && pass "App consumes ui/sonner" \
  || fail "App does not import ui/sonner"

has_match 'from "@/components/ui/resizable"' "$SRC/components/ShellPanels.tsx" \
  && pass "ShellPanels consumes ui/resizable" \
  || fail "ShellPanels does not import ui/resizable"

has_match 'from "\./components/ui/resizable"|from "@/components/ui/resizable"' "$SRC/App.tsx" \
  && pass "App consumes ui/resizable" \
  || fail "App does not import ui/resizable"

# ── 4. Unit proof ──────────────────────────────────────────────────────────
pnpm -C apps/desktop exec vitest run \
  src/components/ui/primitives.test.tsx \
  src/components/CommandPalette.test.tsx \
  src/components/EngineeringInput.test.tsx \
  src/components/AnalysisSetupForms.test.tsx \
  src/components/SettingsPanel.test.tsx \
  src/components/SimulationSetupDialog.test.tsx \
  --reporter=dot

if [[ "$FAIL" -ne 0 ]]; then
  note "DESIGN-SYSTEM-DRIFT: FAIL"
  exit 1
fi
note "DESIGN-SYSTEM-DRIFT: ok"
echo "DESIGN-SYSTEM-DRIFT: ok — pair with scripts/design-system-dod.sh (both-theme shots) to prove AGENTS §10."
