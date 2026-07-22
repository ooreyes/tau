# Try Tau (macOS Apple silicon)

Tau is a native Mac circuit app (not a website). This is the **v1.0 release build** (ad-hoc signed, not yet Apple-notarized, so the first launch needs one extra click - see below).

## Requirements

- Apple silicon Mac (M1/M2/M3/M4…)
- macOS 11+
- Optional, only for the on-device AI assistant: ~1 GB free for the small
  local model (1.7B) or ~2.5 GB for 4B, plus internet once for the setup

## Install

1. Download `Tau_1.0.0_aarch64.dmg` from the [GitHub Release](https://github.com/ooreyes/tau/releases).
2. Open the DMG and drag **Tau** into **Applications**. Copy the **Examples**
   folder somewhere writable (Desktop is fine) while you're in there.
3. First launch (Gatekeeper, because this build is not notarized yet):
   - In Finder → Applications, **Control-click Tau → Open → Open**
   - Or: open once, then **System Settings → Privacy & Security → Open Anyway**

## Quick try (two minutes)

1. Open Tau, click **Open folder**, and pick your copy of the Examples folder.
2. Open `class-d-amplifier/class-d-starter.asc` - a real LTspice class-D power
   stage, imported natively - and press **Run**. The transient finishes in
   under a second on the embedded ngspice engine.
3. Open `ad8541-buffer/ad8541-buffer.sim` and press **Run** - a real Analog
   Devices AD8541 macromodel simulating as a unity-gain buffer. The Examples
   README walks through the vendor model attach flow (the same path works for
   any manufacturer's `.lib`/`.subckt` file).
4. Import your own `.asc`: open any folder containing it and click the file.
   Probing a wire plots it; the Diagnostics panel explains anything Tau
   couldn't map.

## Optional: on-device AI assistant

1. In Settings, choose **Set up local AI**. Tau installs the on-device runtime
   (bootstraps `uv` if needed) and can download the model - prefer **Qwen3
   1.7B** for a quick try.
2. Open the **Assistant** panel and ask for something concrete, e.g.
   `safe 5 V LED with a series resistor and .tran`. Confirm the proposal and
   Tau lays out the schematic and can auto-run the analysis.

## What this release is / isn't

- **Is:** a native `.app` with a real embedded ngspice engine, LTspice `.asc`
  import verified against a 189-schematic corpus, vendor `.lib`/`.subckt`
  model import, a probe-and-plot workflow, and an optional on-device MLX
  assistant - usable for real circuit work.
- **Isn't:** an LTspice replacement, or Apple-notarized yet (so Gatekeeper
  needs the one-time Control-click Open). Remaining limitations are listed in
  [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Reddit-ready blurb

```
Tau - a native-Mac circuit simulator that opens LTspice .asc files and runs
them on a real embedded ngspice engine. Vendor .lib/.subckt models import and
simulate (the demo runs an actual ADI AD8541 macromodel). Optional on-device
AI assistant, no cloud.

DMG: <release URL>
Install: drag to Applications, Control-click Open once (not notarized yet).
Start with the bundled Examples folder - both demos run in under a second.
Apple silicon only.
```
