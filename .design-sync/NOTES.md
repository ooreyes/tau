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

## The declaration tree is not optional

Without `apps/desktop/types/` **and** `apps/desktop/index.d.ts`, every emitted
`<Name>.d.ts` is an empty `[key: string]: unknown` bag — the API contract the
design agent codes against would say nothing about any of the 156 components.
Two separate facts make this fiddly, and both are easy to regress:

1. The converter resolves props by looking for a `<Name>Props` interface and,
   failing that, by reading the component's **first call-signature parameter**.
   Tau types most props inline, so the second path is the one that matters —
   and it needs a real `.d.ts` tree to read.
2. `findTypesRoot()` discovers `apps/desktop/types/`, but `projectFor()` does
   **not** use it for the entry: it resolves `<pkgDir>/<pkg.types>` and falls
   back to `<pkgDir>/index.d.ts`. Emitting the tree alone left
   `exported PascalCase symbols: 0`. `build.sh` therefore also writes
   `apps/desktop/index.d.ts` (the barrel declaration with `./src/` rebased to
   `./types/src/`). Both are gitignored.

Check on every re-sync: the build log must say
`exported PascalCase symbols: 156`. A `0` there means empty contracts, even
though the build still exits 0.

## Node builtins and Vite-only imports

The barrel drags in Tau's whole app graph, which reaches code esbuild cannot
bundle for a browser. Both are fixed by `paths` entries in
`.design-sync/tsconfig.ds.json` (`cfg.tsconfig`), not by touching app code:

- `node:*` → `stubs/node/*.js`, CommonJS proxies that throw a named error if
  anything ever calls one. Reached via `@anthropic-ai/sdk`'s credential
  loaders and `src/io/*`'s filesystem readers — never on a render path.
  Subpath builtins (`node:fs/promises`) need their own **flat** entry listed
  **before** the `node:*` wildcard; a `fs/` directory next to `fs.js` makes
  the resolver return the directory and the build dies with
  `Cannot read file …: is a directory`.
- `./bundled/*.sub?raw` → generated stubs carrying the real file text.

**`tsconfig.ds.json` must contain no comments and no `"//"` key.** The
converter strips `//` comments with a regex that also eats the `//` inside
`"//":`, which breaks the JSON parse — and the failure is silent: the paths
plugin just returns null and every alias stops resolving.

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

The cached `chromium_headless_shell-1228` build was **corrupt**: unsigned on
arm64, so macOS SIGKILLed it and playwright reported the useless
`browserType.launch: spawn Unknown system error -88`. The full
`Google Chrome for Testing` binary in the same cache ran fine, which is the
tell. Ad-hoc `codesign` did not fix it (`main executable failed strict
validation`); re-downloading did:

```sh
rm -rf ~/Library/Caches/ms-playwright/chromium_headless_shell-1228
(cd .ds-sync && npx playwright install chromium-headless-shell)
```

If a future run sees error `-88`, this is it — not a sandbox or permissions
problem.

## Fonts — decided, do not re-litigate

`[FONT_MISSING] "SF Pro Text", "SF Pro Display"` is **expected and accepted**.
Tau's CSS names Apple's system faces; Apple's licence does not permit
redistributing them in a web bundle, so nothing is shipped in `fonts/` and the
existing fallback stack resolves. On macOS that stack *is* SF Pro, so cards
render correctly for anyone reviewing on a Mac; other platforms substitute the
system UI font.

Decided by the repo owner on 2026-08-09, choosing system fallback over
shipping Inter as a look-alike. Do not "fix" this warn by wiring
`cfg.extraFonts` at a downloaded SF Pro — that would be a licence violation.
It is recorded under Known render warns below so a re-sync does not read it as
new.

## Authoring previews for this repo — what works

- Preview files import from `'@tau/desktop'`; the converter rewrites that to
  `window.TauDS`. `lucide-react`, `sonner` and `react` hooks all import
  normally inside a preview.
- Zustand-backed components (`StatusBar`, `Palette`, `Toolbar`) render fine
  with no provider — the stores are module-global.
- **Radix ContextMenu has no controlled `open` prop.** Right-click is the only
  way in, so its previews dispatch a real `contextmenu` MouseEvent on mount.
  This works and is how `ContextMenu*` cards show an open menu.
- Overlay components (anything portalled or `position: fixed`) trip
  `[GRID_OVERFLOW] … outside their cells`. The remedy is
  `cfg.overrides.<Name> = {cardMode: "single", primaryStory: "<export>"}` —
  27 components need it. Nine wide ones use `{cardMode: "column"}`. These are
  presentation-only; grades carry across the targeted rebuild.
- Components whose props are read unguarded crash the floor card. The fix is
  always a fuller prop object, e.g. `LearningPathCoach` reads
  `tip.shortcuts.length` and needs the array.

## Known render warns

These are triaged and expected. A re-sync that reports them is **not**
reporting anything new; a warn *not* in this list is.

- `[FONT_MISSING] "SF Pro Text", "SF Pro Display"` — see the Fonts section
  above. Decided, licensed-out, permanent.
- `[TOKENS_MISSING]` (9 named, 23 real) — see "Dangling CSS tokens" below.
- `[RENDER_THIN] BodeMascot` — an SVG mark with no text by construction.
- `[RENDER_THIN] ComponentSymbol` — SVG schematic symbols, no text nodes.
- `[DTS_STYLE_SYSTEM] filtering @types/react props` — expected; the shadcn
  primitives spread `React.ComponentProps<"button">` and the extractor filters
  the inherited DOM prop bag.

## Dangling CSS tokens — a real finding in Tau's own CSS

`_ds_bundle.css` references 23 custom properties it never defines. Eight are
set at runtime by Radix (`--radix-*`) and two by Tailwind (`--tw-duration`,
`--tw-ease`) — those are fine. The remaining **13 are genuinely undefined**:

`--focus`, `--foreground`, `--fs-mini`, `--fs-sm`, `--fs-small`, `--fs-ui`,
`--ink`, `--ink-2`, `--material-thin`, `--panel-1`, `--text-dim`,
`--text-muted`, `--text-secondary`

They resolve to nothing, so whatever they style silently falls back. Nothing in
`apps/desktop/src` defines them and no JS sets them (`setProperty` appears once,
in `plotPng.ts`, for a different purpose). Also `.confirm-dialog` is applied by
`ui/confirm.tsx` but has no rule in the shipped CSS. **This is a pre-existing
app bug, not a sync artifact** — the sync just surfaced it. Worth fixing in
`App.css`; until then the warn stays.

## Two components that fight the card, and how they were pinned

- **`LearningPathCoach`** is `position: fixed` (bottom-right of the window), so
  it escaped its cell entirely and measured 0 px tall. Its preview wraps it in
  a `transform: translateZ(0)` container — a transformed ancestor becomes the
  containing block for fixed descendants, which pins it inside the cell without
  touching the component. Same trick works for anything else `fixed`.
- **`ComponentSymbol`** returns *bare SVG children* (`<line>`, `<path>`, …)
  with no `<svg>` wrapper and no stroke — the canvas supplies both. Rendered in
  an HTML container it draws nothing at all. Its preview mounts it inside an
  `<svg viewBox="-44 -44 88 88" stroke="var(--text)" fill="none">`. If a future
  sync shows empty symbol boxes, this is why.

## `Toaster` needs `toast` from the bundle, not from `sonner`

sonner's toast store is module state. A preview that does
`import { toast } from 'sonner'` gets a **second copy** bundled into the
preview, with its own store — so the toasts never reach the `<Toaster>` that
came from `window.TauDS`, and the card renders empty. That is exactly what
happened on the first attempt.

The fix is `cfg.extraEntries: ["./src/components/ui/sonner.tsx"]`, which merges
that module's exports (including the non-PascalCase `toast`) into
`window.TauDS`. The preview then imports both from `'@tau/desktop'` and drives
the one real instance. Build log confirms it:
`bundle export list: 157` (156 components + `toast`).

The preview also passes `expand visibleToasts={3}` so all three tones are
visible at once instead of sonner's default collapsed stack, and wraps the host
in a `transform` container so its `position: fixed` resolves inside the card.

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
