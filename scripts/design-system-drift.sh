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

# Where the token zone ends is an explicit marker in App.css, not a hardcoded
# line number and not an inference.
#
# A literal line number drifts the moment a token is added. But the inference
# that replaced it was worse in a quieter way: it took the LAST column-0 `:root`
# block anywhere in the file, so adding something like `:root[data-density]`
# further down would extend the "tokens may declare raw color" zone over
# everything above it, turning the hex check off for thousands of lines while
# still printing PASS. A gate that fails loudly when it cannot find its anchor
# is the only safe shape here.
TOKEN_ZONE_END="$(awk '/TAU-TOKEN-ZONE-END/ { print NR; exit }' "$SRC/App.css")"
if [[ -z "$TOKEN_ZONE_END" ]]; then
  fail "App.css has no TAU-TOKEN-ZONE-END marker, so the hex gate cannot tell tokens from drift."
  TOKEN_ZONE_END=0
fi
# A marker that somehow landed near the top of the file would read as "almost
# nothing is a token", and one that failed to parse reads as "everything is".
# Both are hard stops rather than a silent pass.
if [[ "$TOKEN_ZONE_END" -lt 100 ]]; then
  fail "the App.css token-zone marker is at line $TOKEN_ZONE_END, which is too early to be real."
  TOKEN_ZONE_END=0
fi

HEX_CSS_LATE="$(scan_file '#[0-9a-fA-F]{3,8}\b' "$SRC/App.css" | awk -F: -v end="$TOKEN_ZONE_END" '$1+0 > end' || true)"
if [[ -n "$HEX_CSS_LATE" ]]; then
  fail "App.css hex outside token zone (lines >$TOKEN_ZONE_END):"
  note "$HEX_CSS_LATE"
else
  pass "App.css hex confined to token zone (≤$TOKEN_ZONE_END)"
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

# Adoption is checked file-agnostically: does anything outside components/ui
# import this primitive at all?
#
# These four checks used to name the importing file - "ShellPanels consumes
# ui/resizable", "App consumes ui/sonner". That encodes today's file layout
# into a gate whose actual job is to prove the primitive is adopted, so the
# canvas-first redesign (which dissolves ShellPanels.tsx entirely) would have
# tripped it while adopting the primitives perfectly well. The gate would have
# been right to complain and wrong about why, which is the worst kind of red.
#
# What is deliberately NOT checked here any more is PLACEMENT - "the Toaster is
# mounted at the app root" is a real requirement, but a grep cannot survive a
# refactor and a render assertion can, so it lives in the shell contract test.
for primitive in command sonner resizable; do
  # Exclude by the FILE the hit is in, anchored to the start of the line, not
  # by the line's content: every one of these hits contains the substring
  # "/components/ui/" inside the import path itself, so an unanchored filter
  # silently removes every consumer and reports the primitive as unadopted.
  CONSUMERS="$(scan_src "from \"[./@][^\"]*/ui/$primitive\"" ts tsx \
    | grep -vE "^$SRC/components/ui/" || true)"
  if [[ -n "$CONSUMERS" ]]; then
    pass "ui/$primitive is consumed ($(printf '%s\n' "$CONSUMERS" | wc -l | tr -d ' ') site(s))"
  else
    fail "nothing outside components/ui imports ui/$primitive"
  fi
done

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
