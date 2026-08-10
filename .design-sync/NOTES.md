# design-sync notes — Tau

Repo-specific gotchas for syncing Tau to claude.ai/design. Read this before a
re-sync; it is the accumulated cost of the first import.

## The shape of this repo

- **Tau is an application, not a component library.** There is no package that
  builds a distributable UI library, no `dist/` entry, and no Storybook. The
  "design system" is `apps/desktop/src` itself: `App.css` (~10k lines of
  tokens + hand-written component rules), `src/styles/tokens.css` (the
  Tailwind v4 theme layer), and ~156 React components under
  `src/components/`, `src/settings/`, and `src/schematic/`.
- `packages/schematic-core` is types-only (no components) — not synced.
- Because there is no library entry, two inputs are **generated** by
  `.design-sync/build.sh` (`cfg.buildCmd`) and gitignored:
  - `apps/desktop/.ds-entry.tsx` — the barrel the converter bundles. Explicit
    named re-exports (never `export *`) so a duplicate component name across
    two files fails loudly in `gen-entry.mjs` instead of silently dropping a
    component. `App.tsx` and `main.tsx` are excluded: `main.tsx` calls
    `ReactDOM.createRoot(...)` at import time and would execute the whole app
    inside every preview card.
  - `apps/desktop/.ds-styles.css` — the compiled stylesheet (`cfg.cssEntry`).
- `cfg.componentSrcMap` is a **full enumeration**, not the usual sparse
  override map. With an explicit `--entry` and no shipped `.d.ts` tree, the
  converter's own discovery finds nothing (it only falls back to a source scan
  in synth-entry mode), so every component must be pinned. The map is
  regenerated into `.design-sync/.cache/component-src-map.json` by
  `gen-entry.mjs` — **on a re-sync, diff that file against `config.json` and
  fold in added/removed components.**

## Why the CSS must come from a vite build

`src/styles/tokens.css` starts with `@import "tailwindcss/utilities.css"`.
Tailwind v4 generates that layer at build time from the classes actually used,
so the raw source files are not a usable `cssEntry` — pointing at them ships a
stylesheet with no utilities and every utility-migrated panel renders
unstyled. `build.sh` therefore runs `vite build` purely to get the compiled
CSS and copies the hash-named output to a stable `.ds-styles.css`.

`build.sh` calls `vite build` directly rather than `pnpm build`, because the
package script is `tsc && vite build` and a pre-existing typecheck error on a
WIP branch would block a sync that does not depend on typechecking.

## Theme

Tau's themes are driven by `data-theme` on `<html>`, with no attribute meaning
"follow the OS" (`App.css` §`:root` is the dark palette;
`@media (prefers-color-scheme: light)` derives light). Preview cards set no
attribute and headless chromium reports a light color-scheme, so **cards render
the light theme** — which is Tau's product default. Nothing to configure.

## Fork: `overrides/source-kit.mjs`

Declared in `cfg.libOverrides`. Upstream derives a component's group from the
last non-generic directory segment of its source path; in Tau that is
`components/` or `components/ui/` for ~120 of 156 components, all of which
collapse into one `general` group. The fork adds a `TAU_GROUPS` path→group
table (primitives, app-chrome, plots, canvas, dialogs, editors, instrument,
inspector, results, settings, schematic). Everything else is verbatim
upstream — on a re-sync, diff it against `.ds-sync/lib/source-kit.mjs` and
re-apply the two marked `TAU FORK` hunks if upstream moved.

Grouping via doc-frontmatter `category` was rejected deliberately: a matched
doc **replaces** the synthesized `.prompt.md` body, so 156 frontmatter-only
stubs would have traded the generated props/examples docs for nothing.

## Fresh-clone setup

`gen-entry.mjs` and the fork import bare packages (`ts-morph`, and the staged
lib), which resolve through a gitignored symlink:

```sh
ln -sfn ../.ds-sync/node_modules .design-sync/node_modules
```

Recreate it after every fresh clone, before running `build.sh`.

## Playwright

`chromium-1228` is already in `~/Library/Caches/ms-playwright` (macOS path, not
`~/.cache`) and matches the repo's pinned `playwright@1.61.1`, so the render
check needs only `npm i playwright@1.61.1` inside `.ds-sync/` — no ~200MB
browser download.

## Known render warns

_(none recorded yet — first sync in progress)_

## Re-sync risks

- **`componentSrcMap` rots.** It is a snapshot of the components that existed
  at sync time. Adding a component to the app does not add it to the DS until
  the map is regenerated (see above). A component that is renamed or moved
  leaves a stale entry that silently drops it.
- **`cssEntry` depends on a successful `vite build`.** If the app build breaks,
  `.ds-styles.css` silently keeps the previous build's bytes and the sync ships
  stale styling with no error.
- **The barrel bundles the whole app.** Every component's transitive imports
  (zustand stores, the simulation engine, `@tauri-apps/api`) land in
  `_ds_bundle.js`. It works because nothing runs at import time, but a new
  module-level side effect anywhere in that graph would break every preview at
  once — if all cards fail after an unrelated app change, look for a new
  top-level `await`/`createRoot`/Tauri call, not for a design-sync bug.
