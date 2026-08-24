---
name: project_usb_psu_walkthrough
description: The USB_PSU_WALKTHROUGH doc page is a design-reviewed surface, and its claims are cheaply verifiable because ngspice is installed locally
metadata:
  type: project
---

`USB_PSU_WALKTHROUGH/WALKTHROUGH.html` is a standalone teaching document (not part of the app bundle) that is nonetheless reviewed against the `tau-instrument-aesthetic` skill. It inlines a copy of the `:root` tokens in its own `<style>` block rather than importing `App.css`, so token drift between the page and the app is possible and worth checking.

**Why:** it is the public worked example for hierarchical subcircuits, so it carries the same "is this an instrument or a dashboard" burden as an app surface, and the orchestrator runs multi-reviewer passes over it (module form, type, color, spacing) with fixes applied centrally rather than by the reviewer.

**How to apply:** every numeric claim on that page is reproducible, and that is the review bar. `ngspice` 46 is on PATH at `/opt/homebrew/bin/ngspice`, and `USB_PSU_WALKTHROUGH/DECK.txt` runs in about 6 s. Strip its `.tran`/`.end` lines, append a `.control` block with `tran 1e-7 0.06` plus `meas`/`wrdata`, and run in the scratchpad. That yields real waveform data for proposed sparklines and lets a load sweep test whether a headline number is load dependent, instead of arguing about it. This is the concrete form of [[tau-uiux-evidence-bar]]: do not accept or reject a readout on the page's own prose.
