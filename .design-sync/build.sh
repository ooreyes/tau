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

(cd apps/desktop && npx vite build)
cp "$(ls -t apps/desktop/dist/assets/*.css | head -1)" apps/desktop/.ds-styles.css
node .design-sync/gen-entry.mjs

# 3. Declaration tree → apps/desktop/types/, which is where findTypesRoot looks.
#
# Without it every emitted <Name>.d.ts is an empty `[key: string]: unknown` bag:
# the converter resolves props from a component's first call-signature
# parameter, and with no .d.ts tree there is no signature to read. Tau types
# most props inline (`function SettingsRow({label}: {label: string})`) rather
# than as a `<Name>Props` interface, so that call-signature path is the only
# one that yields a real contract here.
#
# Type ERRORS are expected and tolerated (noEmitOnError is off): the `?raw`
# import has no ambient declaration, and a WIP branch may not typecheck. The
# declarations still emit.
cat > apps/desktop/.ds-tsconfig.dts.json <<'JSON'
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "./types",
    "rootDir": ".",
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "skipLibCheck": true
  },
  "include": ["src", ".ds-entry.tsx"],
  "references": []
}
JSON
rm -rf apps/desktop/types
mkdir -p .design-sync/.cache
(cd apps/desktop && npx tsc -p .ds-tsconfig.dts.json) > .design-sync/.cache/dts-emit.log 2>&1 || true
# The converter resolves its declaration entry as `<pkgDir>/<pkg.types>` and
# falls back to `<pkgDir>/index.d.ts` — it does NOT look inside the types root
# it discovered. Since package.json is app code we don't touch, plant the entry
# at the package root instead, with the emitted tree's paths rebased.
sed 's#"\./src/#"./types/src/#g' apps/desktop/types/.ds-entry.d.ts > apps/desktop/index.d.ts
echo "dts: $(find apps/desktop/types -name '*.d.ts' | wc -l | tr -d ' ') declaration files"
