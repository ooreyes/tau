# Try Tau (macOS Apple silicon)

Tau is a native Mac circuit app (not a website). This is the **v1.0 release build** (ad-hoc signed, not yet Apple-notarized, so the first launch needs one extra click - see below).

## Requirements

- Apple silicon Mac (M1/M2/M3/M4…)
- macOS 11+
- ~1 GB free for the small local model (1.7B), or ~2.5 GB for 4B
- Internet once, for the first local-AI setup

## Install

1. Download `Tau_1.0.0_aarch64.dmg` from the [GitHub Release](https://github.com/ooreyes/tau/releases).
2. Open the DMG and drag **Tau** into **Applications**.
3. First launch (Gatekeeper, because this build is not notarized yet):
   - In Finder → Applications, **Control-click Tau → Open → Open**
   - Or: open once, then **System Settings → Privacy & Security → Open Anyway**
4. On first run, choose **Set up local AI**.
   - Tau installs the on-device runtime (bootstraps `uv` if needed) and can download the model.
   - Prefer **Qwen3 1.7B** for a quick try; use **4B** if you want better circuit proposals.

## Quick try

1. Open the **Assistant** panel.
2. Ask for something concrete, e.g. `safe 5 V LED with a series resistor and .tran`.
3. Confirm the proposal. Tau lays out the schematic and can auto-run the analysis.
4. Vague prompts like `a voltage source` should get a short clarifying question.

## What this release is / isn’t

- **Is:** a native `.app` with a real embedded ngspice engine, LTspice `.asc` import, probe-and-plot workflow, and an on-device MLX assistant - usable for real circuit work.
- **Isn’t:** Apple-notarized yet (so Gatekeeper needs the one-time Control-click Open). Remaining limitations are listed in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Reddit-ready blurb

```
Apple silicon Mac preview of Tau - native LTspice-ish schematic + sim app with on-device AI.

DMG: <release URL>
Install: drag to Applications → Control-click Open (unsigned preview).
First launch: Set up local AI → try “safe 5V LED with series resistor and .tran”.
Needs M-series Mac + internet once for the model download (~900 MB for 1.7B).
```
