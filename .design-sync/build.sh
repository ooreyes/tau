#!/usr/bin/env bash
# cfg.buildCmd — prepares the two generated inputs the converter needs.
#
# Tau ships no component-library dist, so "build" here means:
#   1. vite build of the app, purely to compile the stylesheet. Tau's CSS is
#      Tailwind v4 (@import "tailwindcss/utilities.css") layered over App.css,
#      so the raw sources are NOT a usable cssEntry — only the vite output has
#      the utility layer generated. Copied to a stable, unhashed path.
#   2. the barrel entry + componentSrcMap (see gen-entry.mjs).
#
# `vite build` is invoked directly rather than `pnpm build` on purpose: the
# package script is `tsc && vite build`, and a pre-existing typecheck error on a
# WIP branch would block a sync that doesn't depend on typechecking.
set -euo pipefail
cd "$(dirname "$0")/.."

npx --prefix apps/desktop vite build --root apps/desktop
cp "$(ls -t apps/desktop/dist/assets/*.css | head -1)" apps/desktop/.ds-styles.css
node .design-sync/gen-entry.mjs
