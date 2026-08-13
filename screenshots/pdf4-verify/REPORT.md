# PDF4 verification checkpoint

Date: 2026-08-13  
Branch: `fix/pdf3-fourteen-items`  
Base: `pdf3-fourteen-items-reviewed` / `5d476d1`  
Checkpoint: `0ece2f7`

This is a durable, green checkpoint, not the final reviewed tag. GPT-5.6 Luna
authored product code. GPT-5.6 Sol performed read-only closure reviews.

## Automated verification

- `pnpm -C apps/desktop typecheck`: pass.
- `pnpm -C apps/desktop test`: 272 files passed, 2 skipped; 4,779 tests passed,
  9 skipped; 0 failed.
- `pnpm --filter @tau/desktop build`: pass.
- `node scripts/design-system-dod-grep.mjs`: pass; zero hex outside tokens and
  zero native selects.
- `cargo fmt --check`: pass.
- `cargo clippy -- -D warnings`: pass.
- `cargo test`: 104 passed, 42 ignored, 0 failed.
- `TAU_NGSPICE_LIB=... cargo test -- --ignored`: 42 passed, 0 failed.
- Project hierarchy fixture through Tau's staged `--tau-spice-worker` and
  bundled `libngspice.dylib`: 10 passed, 0 failed.
- Fresh `pnpm --filter @tau/desktop tauri build`: Tau.app and
  `Tau_1.0.0_aarch64.dmg` produced.
- `codesign --verify --deep --strict`: pass (ad-hoc unsigned build).
- `hdiutil verify`: valid checksum.

## Visual evidence

`chrome/` contains the responsive light/dark shell and Settings matrix at
900x600, 1280x800, and 1440x900. It proves empty-state centering, the utility
Settings placement, minimum-window reachability, and both themes.

`native/10-final-inspector-fixture-packaged.jpg` is the freshly rebuilt
packaged WKWebView with the inspector fixture fitted. It shows the 32px toolbar,
child-sheet interface action, structured diagnostics, A/K terminal identity,
normal diode-body ink, and LED arrow-only tint.

`native/11-final-zener-inspector-packaged.jpg` shows the final 5V1 zener
inspector without the earlier irrelevant `.lib/.sub` action.

Files 01-04 preserve earlier packaged/before-review states for comparison.

## Open review findings

The checkpoint remains blocked on five functional findings and one copy issue:
duplicate manual probe colors; invalid switch-text classification; named-switch
preview refusal; simulator-mode diagnostic focus; visible net highlighting;
and “applied, save document to persist” copy. These are intentionally not
patched by Sol. Resume with Luna when its weekly allowance resets.
