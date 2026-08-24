/**
 * Writes (and verifies) the BUCK_SUBCRCT_TEST folder: the buck block driving a
 * red LED.
 *
 * Same contract as `buckSubcircuitFolder.test.ts`, and deliberately the same
 * child sheet - the point of this folder is that ONE child `.asc` serves two
 * different parents, which is only interesting if the child is genuinely
 * unmodified. The circuit numbers come from `buckSubcircuitFixture` so the
 * files on disk cannot drift from the circuit under test.
 *
 * What this folder proves that the 1 k folder does not: current has to leave
 * the child through `VOUT`, cross the block boundary, pass through R1 and the
 * LED, and return through ground. A resistor to ground can be satisfied by a
 * voltage appearing anywhere; a diode conducting 9 mA at its own forward drop
 * cannot.
 *
 * By default this test only ASSERTS. Set `WRITE_BUCK_LED=1` to also write the
 * folder, so a normal test run never touches the working tree:
 *
 *   WRITE_BUCK_LED=1 npx vitest run --root apps/desktop \
 *     src/schematic/buckLedFolder.test.ts
 */
import { describe, expect, it } from "vitest";
import { buckChildSheet, topSheetLedLoad, LED_SERIES_OHMS } from "./buckSubcircuitFixture";
import { buildProjectHierarchyDeck } from "./projectHierarchy";
import { schematicToAsc } from "../io/ascExport";
import { serializeSchematicFile } from "../project/types";

/** Repo-root-relative output folder. The name is the user's, kept verbatim. */
const FOLDER = "BUCK_SUBCRCT_TEST";
/** Fixed so re-running the generator produces no spurious diff. */
const SAVED_AT = "2026-08-17T00:00:00.000Z";

const CHILD_NAME = "Buck25to5.asc";
const PARENT_NAME = "top.sim";

/** Walk up for the workspace marker; cwd is the runner's, not the repo root. */
async function repoRoot(): Promise<string> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  let root = process.cwd();
  while (!fs.existsSync(path.join(root, "pnpm-workspace.yaml"))) {
    const up = path.dirname(root);
    if (up === root) throw new Error("could not locate the repo root (no pnpm-workspace.yaml above cwd)");
    root = up;
  }
  return root;
}

function buildArtifacts() {
  const child = buckChildSheet();
  const parent = topSheetLedLoad(CHILD_NAME);

  const childAsc = schematicToAsc({
    components: child.components,
    wires: child.wires,
    netLabels: child.netLabels,
  });
  const parentSim = serializeSchematicFile(
    PARENT_NAME,
    {
      components: parent.components,
      wires: parent.wires,
      netLabels: parent.netLabels,
      directives: parent.directives ?? [],
      probes: [],
    } as never,
    SAVED_AT,
  );
  const built = buildProjectHierarchyDeck({
    rootPath: PARENT_NAME,
    root: parent as never,
    sheets: [{ path: CHILD_NAME, document: child as never }],
    // 20 ns steps over 5 ms: at the default resolution the emitted `.tran` had
    // about two points per 5 us switching cycle, so a reader running DECK.txt
    // would measure noise rather than the converter.
    analysis: { kind: "tran", stopTime: 5e-3, steps: 250_000 } as never,
  });
  return { child, parent, childAsc, parentSim, built };
}

describe("the BUCK_SUBCRCT_TEST proof folder", () => {
  it("carries the link and the LED load on the parent sheet", () => {
    const { parent } = buildArtifacts();
    const block = parent.components.find((component) => component.id === "x1");
    expect(block?.projectSubcircuit).toEqual({
      sheetPath: CHILD_NAME,
      model: "Buck25to5",
      ports: ["VIN", "VOUT"],
    });
    const led = parent.components.find((component) => component.id === "d1");
    expect(led?.kind).toBe("led");
    // Spelled, not defaulted - see the fixture's note on ledHasExplicitColor.
    expect(led?.value).toBe("LED red");
    const series = parent.components.find((component) => component.id === "r1");
    expect(series?.value).toBe(String(LED_SERIES_OHMS));
  });

  /**
   * The net-crossing assertion, and the reason this folder exists.
   *
   * Every node name here is read back OUT of the generated deck rather than
   * asserted as a literal, so the test states a relationship - "the net V1
   * drives is the net the block's first port receives" - instead of restating
   * the netlister's naming convention. A rename cannot make it pass falsely.
   */
  it("binds the parent's nets to the child's ports, and the LED to the block output", () => {
    const { built } = buildArtifacts();
    const netlist = built.deck.netlist;

    // The child declares the interface, in order.
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0].text.split("\n")[0]).toBe(".subckt Buck25to5 VIN VOUT");

    // The parent instantiates it with two of its own nets.
    const instance = /^X1 (\S+) (\S+) Buck25to5$/mi.exec(netlist);
    expect(instance, "the block instance is emitted").toBeTruthy();
    const [, vinNet, voutNet] = instance!;
    expect(vinNet).not.toBe(voutNet);

    // Left of the boundary: the 25 V source sits on the net feeding port VIN.
    expect(netlist).toMatch(new RegExp(`^V1 ${vinNet} 0 DC 25$`, "mi"));
    // Right of the boundary: the LED's series resistor taps the net port VOUT
    // drives, and the LED hangs off that resistor - so the 5 V the child makes
    // is what lights the LED.
    const seriesLine = new RegExp(`^R1 ${voutNet} (\\S+) ${LED_SERIES_OHMS}$`, "mi").exec(netlist);
    expect(seriesLine, "the series resistor taps the block output net").toBeTruthy();
    const anodeNet = seriesLine![1];
    // A palette LED compiles to an XSPICE `A` device plus a 0 V sense source.
    expect(netlist).toMatch(new RegExp(`^A\\S+ ${anodeNet} (\\S+) TAU_LED_IDEAL_2V$`, "mi"));
    expect(netlist, "red LED's ideal forward drop").toMatch(/^\.model TAU_LED_IDEAL_2V sidiode\(.*Vfwd=2\b/mi);
    // The sense source is what makes the LED current measurable at all.
    expect(netlist).toMatch(/^V__TAU_ID_D1 \S+ 0 0$/mi);
    expect(netlist).toMatch(/^\.save all v__tau_id_d1#branch$/mi);
  });

  it("writes the folder when asked", async () => {
    if (process.env.WRITE_BUCK_LED !== "1") {
      expect(true).toBe(true);
      return;
    }
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { childAsc, parentSim, built } = buildArtifacts();
    const dir = path.join(await repoRoot(), FOLDER);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, CHILD_NAME), childAsc.text);
    fs.writeFileSync(path.join(dir, PARENT_NAME), `${parentSim.contents}\n`);
    // Notes go AFTER the deck's own first line, never before it: SPICE treats
    // line 1 as the title, so prepending a comment block promotes the header to
    // the title and leaves "Tau generated circuit" to be parsed as a device.
    const deckLines = built.deck.netlist.split("\n");
    fs.writeFileSync(
      path.join(dir, "DECK.txt"),
      [deckLines[0], ...DECK_NOTES, ...deckLines.slice(1)].join("\n") + "\n",
    );
    fs.writeFileSync(path.join(dir, "README.md"), README);
    expect(fs.existsSync(path.join(dir, CHILD_NAME))).toBe(true);
  });
});

/**
 * The committed folder, compiled from the bytes actually on disk, through the
 * same loader the app uses. Everything above works from freshly generated
 * content, which cannot catch the folder going stale.
 */
describe("the committed BUCK_SUBCRCT_TEST folder still compiles", () => {
  it("loads the .asc child and the .sim parent from disk and lights the LED", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(await repoRoot(), FOLDER);
    if (!fs.existsSync(dir)) {
      // The folder is a deliverable, not a build output - if it is absent, say
      // so plainly rather than passing quietly.
      throw new Error(`${FOLDER}/ is missing. Regenerate with WRITE_BUCK_LED=1.`);
    }

    const { loadProjectHierarchySheets } = await import("./projectHierarchyRuntime");
    const { validateSchematicDocument } = await import("./documentValidation");

    const loaded = await loadProjectHierarchySheets({
      projectRoot: dir,
      rootSheetPath: path.join(dir, PARENT_NAME),
      tree: [
        { name: PARENT_NAME, path: path.join(dir, PARENT_NAME), kind: "file" },
        { name: CHILD_NAME, path: path.join(dir, CHILD_NAME), kind: "file" },
      ],
      readText: async (target) => fs.readFileSync(target, "utf8"),
    });
    expect(loaded.rootPath).toBe(PARENT_NAME);
    expect(loaded.sheets.find((entry) => entry.path === CHILD_NAME), "the .asc child loaded from disk").toBeDefined();

    const parentDoc = validateSchematicDocument(
      JSON.parse(fs.readFileSync(path.join(dir, PARENT_NAME), "utf8")) as unknown,
    );
    const built = buildProjectHierarchyDeck({
      rootPath: PARENT_NAME,
      root: parentDoc,
      sheets: loaded.sheets,
      analysis: { kind: "tran", stopTime: 5e-3, steps: 250_000 } as never,
    });
    expect(built.blocks[0].text.split("\n")[0]).toBe(".subckt Buck25to5 VIN VOUT");
    // The catch diode must stay a real junction: the ideal one does not
    // converge in a hard-switched converter, so this is really asserting the
    // on-disk sheet did not quietly become the ideal variant.
    expect(built.blocks[0].text, "catch diode is a real junction, on one line").toMatch(
      /^D\S+ \S+ \S+ TAU_DIODE\S*$/m,
    );
    expect(built.blocks[0].text, "no ideal junction inside the converter").not.toMatch(/IDEAL/i);
    // The LED, by contrast, is ideal - and it lives OUTSIDE the block.
    expect(built.deck.netlist).toMatch(/^A\S+ \S+ \S+ TAU_LED_IDEAL_2V$/mi);

    // The committed DECK.txt must still be what the compiler produces, so a
    // reader running `ngspice -b DECK.txt` sees the same circuit as the app.
    const committedDeck = fs.readFileSync(path.join(dir, "DECK.txt"), "utf8");
    const withoutNotes = committedDeck.split("\n").filter((line) => !line.startsWith("*")).join("\n");
    expect(withoutNotes.trimEnd()).toBe(built.deck.netlist.trimEnd());
  });
});

const DECK_NOTES = [
  "* The deck Tau generates from top.sim + Buck25to5.asc.",
  "* Written by buckLedFolder.test.ts - do not edit by hand.",
  "*",
  "* The .subckt body below was compiled from the LINKED .asc sheet. Note that",
  "* VIN and VOUT are the child's ports: the X1 line binds the parent's own",
  "* nets to them, which is the whole claim this folder exists to prove.",
  "*",
  "* Measured in ngspice on this exact deck, averaged over 4-5 ms so the",
  "* startup transient is excluded:",
  "*   V(vin25) = 25.000 V     <- into the block",
  "*   V(out)   =  4.99125 V   <- out of the block, 0.18 % low",
  "*   V(led_a) =  2.00043 V   <- red LED forward drop",
  "*   I(D1)    =  9.06311 mA  <- LED current",
  "*   ripple   =  6.81 mV pk-pk,  startup peak 5.31621 V at 198 us",
  "*",
  "* Run it:  ngspice -b -r out.raw DECK.txt",
  "* The -r is not optional. Batch mode refuses a deck with no .print/.plot/",
  "* .fourier card, and Tau emits .save instead - so plain `ngspice -b DECK.txt`",
  "* parses the circuit and then exits with \"no simulations run!\".",
];

const README = `# BUCK_SUBCRCT_TEST — a 25 V → 5 V buck block lighting a red LED

This folder proves Tau's hierarchical (child-sheet) subcircuit feature end to
end: **the nets really cross the block boundary.**

## What's here

| file | what it is |
| --- | --- |
| \`Buck25to5.asc\` | The **child sheet** — a 25 V → 5 V buck converter, as an ordinary LTspice \`.asc\`. Its two public pins are the net labels \`VIN\` and \`VOUT\`, marked as hierarchy ports (\`IOPIN\`). |
| \`top.sim\` | The **parent sheet** — 25 V source → the block → 330 Ω → red LED → ground. |
| \`DECK.txt\` | The SPICE deck Tau generates from the pair, kept as evidence. Runnable: \`ngspice -b -r out.raw DECK.txt\`. |

The child is byte-identical to the one in \`SUBCRKT/\`. That is the point: one
child sheet, two different parents, no edits to the child.

## Try it

1. Open this folder as a project in Tau.
2. Open \`top.sim\`. The block in the middle is \`Buck25to5\`, pointing at the
   \`.asc\` beside it.
3. Press **Run**.
4. Double-click the block to open the child sheet and see the converter inside.

## How to see the nets passing

The claim is that \`VIN\`/\`VOUT\` on the child are the *same electrical nodes* as
\`VIN25\`/\`OUT\` on the parent. Three independent ways to see it:

**On the parent sheet.** The block's left pin is labelled \`VIN\`, its right pin
\`VOUT\`, and the wires running into them carry the parent's own labels \`VIN25\`
and \`OUT\`. The sheet-interface indicator reports the pinout in order.

**In the generated deck** (\`DECK.txt\`):

\`\`\`
.subckt Buck25to5 VIN VOUT     <- the child declares its interface
...
.ends Buck25to5
V1 vin25 0 DC 25               <- parent's 25 V rail
X1 vin25 out Buck25to5         <- vin25 -> VIN, out -> VOUT
R1 out led_a 330               <- the LED taps the block's output net
\`\`\`

\`X1\` is the seam. \`vin25\` and \`out\` are the *parent's* nets; \`VIN\` and \`VOUT\`
are the *child's* ports. One line binds them, positionally, in the order the
parent's \`p1…pN\` pin bank fixes.

**In measurement.** Measured in real ngspice on this deck, averaged over 4–5 ms
(after the startup transient):

| node | value | why it matters |
| --- | --- | --- |
| \`V(vin25)\` | 25.000 V | what goes into the block |
| \`V(out)\` | **4.99125 V** | what comes out — 0.18 % from 5 V |
| \`V(led_a)\` | 2.00043 V | the red LED's forward drop |
| \`I(D1)\` | **9.06311 mA** | the LED is actually conducting |

Ripple is 6.81 mV pk-pk; the open-loop output overshoots to 5.31621 V at 198 µs
on startup before settling.

A voltage could in principle appear on a floating node. **9 mA flowing through a
diode cannot** — that current is generated inside the child, leaves through
\`VOUT\`, and returns through the parent's ground. That is the proof.

## Why 4.99 V and not exactly 5.00 V

The converter is **open loop** — a fixed duty cycle, no feedback. Duty is
0.2214, which compensates the catch diode's drop:
\`D = (Vout + Vf) / (Vin + Vf) = 5.7 / 25.7\`. At a plain \`D = 5/25 = 0.2\` the same
circuit measures 4.44 V, an 11 % error, so that compensation is load-bearing.

The remaining 0.18 % is real physics, not a bug: this sheet's LED draws ~9 mA
where the \`SUBCRKT/\` sheet's 1 k load draws 5 mA, and the catch diode's forward
drop grows with the current it freewheels. The duty is not retuned for it,
because the child sheet is shared with the 1 k parent and one file cannot hold
two duties. A closed-loop design would trim this out; showing it is more honest
than hiding it.

## Regenerating

Never edit these files by hand — they are written by Tau's own exporters:

\`\`\`
WRITE_BUCK_LED=1 npx vitest run --root apps/desktop src/schematic/buckLedFolder.test.ts
\`\`\`

\`buckLedFolder.test.ts\` also re-reads this folder from disk on every test run
and recompiles it, so if the files here go stale the suite fails.
`;
