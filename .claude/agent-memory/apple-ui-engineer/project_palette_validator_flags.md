---
name: palette-validator-flags
description: validate-palette.mjs accepts --surface and --pairs all; the defaults hide two whole classes of Tau colour bug
metadata:
  type: project
---

`node scripts/validate-palette.mjs "<hexes>" --mode light|dark` also takes
`--surface "#hex"` and `--pairs adjacent|all`. The defaults are the trap:

- Default surface is `#fcfcfb` (light) / `#1a1a19` (dark), **not** Tau's real
  `--bg` (`#EDF1F6` / `#000000`). Pass `--surface "#EDF1F6"` or a hue can clear
  the 3:1 mark floor against the validator's paper and fail against Tau's.
  Measured: the dark `--trace-green #0CA176` passes on `#fcfcfb`, and lands at
  2.90:1 on `#EDF1F6`.
- Default `--pairs adjacent` only checks rotation neighbours. Any surface that
  shows trace slots 1/2/3 **simultaneously** (a legend, a 3-category set, a
  stage index) needs `--pairs all`, because slot 1 vs slot 3 was never
  validated. Measured: green↔sky is ΔE 14.0-14.3 normal vision, under the 15
  floor, in *both* themes.

Two durable results worth not re-deriving:

- **Status hues cannot distinguish categories by colour alone in light theme.**
  `--danger #c02718` ↔ `--signal #8F5C08` is deuteranopia **ΔE 1.5**
  (`--success #248a3d` is no better against either). Any surface with
  trap/warning/ok variants MUST carry a word, glyph or shape; "use the right
  tokens" makes the CVD separation *worse*, not better.
- Trace hues near status hues collide too: vermillion `#D86108` ↔ ochre
  `#B26B00` is protanopia ΔE 0.7, normal-vision ΔE 7.2.

**Why:** DESIGN_SYSTEM §1.5 says "do not change a value or the order by eye"
and prints two verification commands, but neither uses `--surface` or
`--pairs all`, so a reviewer who runs only the documented commands gets
ALL CHECKS PASS on palettes that fail on Tau's actual surfaces.

**How to apply:** reviewing or adding any coloured set, run it with Tau's real
`--bg` as `--surface`, and with `--pairs all` whenever the colours are visible
at the same time rather than being consecutive traces on one scope. See
[[tau-uiux-evidence-bar]] — this is the number that backs the claim.
