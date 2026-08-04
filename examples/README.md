# Tau examples

Tau is a native-Mac, LTspice-.asc-compatible circuit simulator. This schematic
is a small, fast demo meant to prove Tau works the moment you open it.

**The DMG is read-only.** Copy this whole `Examples` folder to somewhere
writable (your Desktop, Documents, wherever) before you open anything in Tau -
that way Tau can save your changes and any attached model files.

Open Tau and click **Open folder** (on the welcome screen, or the folder
button at the top of the project explorer), point it at your copy of this
`examples` folder, then pick a demo from the project explorer on the left.

---

## Class-D amplifier (`class-d-amplifier/`)

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

## Bringing in a manufacturer's model

Op-amps, transistors and ICs in the real world usually aren't ideal math
blocks - they're vendor SPICE macromodels with real quirks (input offset, slew
rate, output clamping). Tau builds in a generic set and resolves everything
else from a model file **you** supply. It ships no manufacturer's model file:
those are the vendors' to license, and redistributing them is theirs to
permit, not ours.

To attach one:

1. Place the part and set its value to the subcircuit name the model file
   defines (the name on its `.subckt` line).
2. Press **Run**. Tau reports that the subcircuit can't be resolved and points
   you at the Model libraries dialog. It refuses the run rather than
   substituting a generic device - a plausible waveform from the wrong model
   is worse than no waveform.
3. Open the toolbar's **Model libraries** button (the library-book icon next
   to Run - also in the command palette as "Model libraries..."), click
   **Attach model file...**, and pick any vendor `.lib`/`.subckt` file you
   have. If you have LTspice installed, its own library folder is full of
   them.
4. Press Run again. The definition resolves by name and simulates on the
   native engine. It stays attached to the document, so the file opens working
   next time.

LTspice-only constructs that vendor macromodels lean on - `VSWITCH`/`ISWITCH`
model cards, parenthesized switch control nodes, `mfg=` annotations - are
translated for you. Encrypted vendor models are not readable outside LTspice
and will not resolve; Tau says so instead of guessing.
