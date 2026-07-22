# Tau examples

Tau is a native-Mac, LTspice-.asc-compatible circuit simulator. These two
schematics are small, fast demos meant to prove Tau works the moment you open
it.

**The DMG is read-only.** Copy this whole `Examples` folder to somewhere
writable (your Desktop, Documents, wherever) before you open anything in Tau -
that way Tau can save your changes and any attached model files.

Open Tau and click **Open folder** (on the welcome screen, or the folder
button at the top of the project explorer), point it at your copy of this
`examples` folder, then pick a demo from the project explorer on the left.

---

## 1. Class-D amplifier (`class-d-amplifier/`)

**What it shows:** a complete class-D audio power stage imported straight from
LTspice - a PWM comparator (op-amp run open-loop against a triangle carrier),
a dead-time control block, a half-bridge MOSFET output stage, and an LC output
filter recovering the audio signal. This is the kind of real, multi-stage
power circuit Tau is built to simulate, not a toy RC network.

**How to open it:** in the project explorer, open `class-d-starter.asc`. Tau
imports the schematic natively, including the dead-time sub-block
(`deadtime.asy` / `deadtime.asc`, shipped alongside the main schematic - keep
all three files in the same folder).

**What to expect when you press Run:** the file carries its own `.tran`
directive, so Run reproduces the circuit's own transient window automatically.
You'll see the PWM node switch cleanly between the supply rails and the
LC-filtered output trace follow a 1 kHz audio tone. On a modern Mac this
finishes in well under a second - there is no wait.

---

## 2. AD8541 unity-gain buffer (`ad8541-buffer/`)

**What it shows:** Tau's vendor model attach flow. Op-amps in the real world
usually aren't ideal math blocks - they're vendor SPICE macromodels with real
quirks (input offset, slew rate, output clamping). `ad8541-buffer.sim` places
a single AD8541 (Analog Devices' rail-to-rail CMOS op-amp) wired as a
single-supply unity-gain buffer, with the vendor's own model already attached
to the document.

`AD8541.lib` is Analog Devices' published SPICE macromodel for the part,
included here for convenience so the demo works offline, exactly as it ships
in LTspice's own component library.

**How to open it:** open `ad8541-buffer.sim` in the project explorer.

**What to expect when you press Run:** the output tracks the 2.5 V input to
within a few millivolts - a real unity-gain buffer, built from the vendor's
actual transistor-level model rather than an idealized op-amp.

**The Model libraries walkthrough:** this file ships with `AD8541.lib`
already attached, which is why it works the moment you open it. To see the
mechanism yourself:

1. Open the toolbar's **Model libraries** button (the library-book icon next
   to Run - you can also reach it from the command palette as
   "Model libraries...").
2. You'll see `AD8541.lib` listed as attached to this document. Click
   **Remove**.
3. Press Run again. Tau now reports that the AD8541 subcircuit can't be
   resolved, and points you at the Model libraries dialog - this is exactly
   what happens when you place a vendor part Tau doesn't build in and forget
   to attach its model.
4. Click **Attach model file...** in the same dialog and pick the
   `AD8541.lib` file in this folder (or any vendor `.lib`/`.subckt` file you
   have). Press Run once more - the buffer works again.

That attach/remove/reattach loop is how you'd bring in any vendor op-amp,
transistor, or IC model LTspice supports but Tau doesn't build in natively.
