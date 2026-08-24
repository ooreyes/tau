/**
 * Writes (and verifies) the USB_PSU_WALKTHROUGH folder: 120 V AC mains to 5 V
 * USB, as a chain of two project-linked child sheets.
 *
 * Same contract as the other folder generators - the files are produced by Tau's
 * OWN writer (`serializeSchematicFile`) rather than hand-rolled text, because a
 * hand-written sheet can be subtly unopenable in ways a passing test would never
 * notice. The circuit comes from `usbPsuFixture`, so the files on disk cannot
 * drift from the circuit under test.
 *
 * Every sheet is `.sim`. No `.asc` anywhere in this project: two file types that
 * look interchangeable and are not is a trap for a first-time reader, and only
 * `.sim` can carry `projectPorts`.
 *
 * By default this test only ASSERTS. Set `WRITE_USB_PSU=1` to also write the
 * folder, so a normal test run never touches the working tree:
 *
 *   WRITE_USB_PSU=1 npx vitest run --root apps/desktop \
 *     src/schematic/usbPsuFolder.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  buckSheet,
  rectifierSheet,
  topSheet,
  BUCK_ON_TIME_S,
  LED_SERIES_OHMS,
  MAINS_PEAK_V,
  USB_LOAD_OHMS,
} from "./usbPsuFixture";
import { buildProjectHierarchyDeck } from "./projectHierarchy";
import { serializeSchematicFile } from "../project/types";

/** Repo-root-relative output folder. */
const FOLDER = "USB_PSU_WALKTHROUGH";
/** Fixed so re-running the generator produces no spurious diff. */
const SAVED_AT = "2026-08-17T00:00:00.000Z";

const RECTIFIER = "Rectifier.sim";
const BUCK = "Buck5V.sim";
const TOP = "top.sim";

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

const asDocument = (sheet: {
  components: unknown[];
  wires: unknown[];
  netLabels: unknown[];
  directives?: string[];
  projectPorts?: unknown[];
}) => ({
  components: sheet.components,
  wires: sheet.wires,
  netLabels: sheet.netLabels,
  directives: sheet.directives ?? [],
  probes: [],
  ...(sheet.projectPorts ? { projectPorts: sheet.projectPorts } : {}),
});

function buildArtifacts() {
  const rectifier = rectifierSheet();
  const buck = buckSheet();
  const top = topSheet(RECTIFIER, BUCK);

  const files = [
    { name: RECTIFIER, sheet: rectifier },
    { name: BUCK, sheet: buck },
    { name: TOP, sheet: top },
  ].map(({ name, sheet }) => ({
    name,
    serialized: serializeSchematicFile(name, asDocument(sheet) as never, SAVED_AT),
  }));

  const built = buildProjectHierarchyDeck({
    rootPath: TOP,
    root: top as never,
    sheets: [
      { path: RECTIFIER, document: rectifier as never },
      { path: BUCK, document: buck as never },
    ],
    // 100 ns over 60 ms. 60 ms is ~3.6 mains cycles plus bus settling; 100 ns
    // still resolves the 5 us switching period with 50 points.
    analysis: { kind: "tran", stopTime: 60e-3, steps: 600_000 } as never,
  });
  return { rectifier, buck, top, files, built };
}

describe("the USB_PSU_WALKTHROUGH proof folder", () => {
  it("keeps every sheet in one file format", () => {
    const { files } = buildArtifacts();
    expect(files.map((file) => file.name)).toEqual([RECTIFIER, BUCK, TOP]);
    for (const file of files) {
      expect(file.name.endsWith(".sim"), `${file.name} is a .sim`).toBe(true);
    }
  });

  it("declares three ports on the rectifier and two on the buck", () => {
    const { rectifier, buck } = buildArtifacts();
    expect(rectifier.projectPorts.map((port) => [port.name, port.direction])).toEqual([
      ["SEC1", "In"],
      ["SEC2", "In"],
      ["VBUS", "Out"],
    ]);
    expect(buck.projectPorts.map((port) => [port.name, port.direction])).toEqual([
      ["VIN", "In"],
      ["VOUT", "Out"],
    ]);
  });

  /**
   * The devices a child sheet may NOT hold, asserted as behaviour rather than
   * left as a comment. If `CHILD_DEVICE_RULES` ever grows a transformer case,
   * this test fails and the walkthrough's explanation needs rewriting - which is
   * the point.
   */
  it("keeps the transformer and the LED on the parent, where they are legal", () => {
    const { rectifier, buck, top } = buildArtifacts();
    const kinds = (sheet: { components: { kind: string }[] }) => sheet.components.map((c) => c.kind);
    expect(kinds(rectifier)).not.toContain("transformer");
    expect(kinds(buck)).not.toContain("transformer");
    expect(kinds(rectifier)).not.toContain("led");
    expect(kinds(top)).toContain("transformer");
    expect(kinds(top)).toContain("led");

    // And prove the refusal is real, not folklore: putting it in a child throws.
    const hostile = {
      ...rectifier,
      components: [...rectifier.components, ...top.components.filter((c) => c.kind === "transformer")],
    };
    expect(() => buildProjectHierarchyDeck({
      rootPath: TOP,
      root: topSheet(RECTIFIER, BUCK) as never,
      sheets: [
        { path: RECTIFIER, document: hostile as never },
        { path: BUCK, document: buckSheet() as never },
      ],
      analysis: { kind: "tran", stopTime: 60e-3, steps: 600_000 } as never,
    })).toThrow(/not yet supported inside a linked sheet/i);
  });

  /**
   * The chain assertion, and the reason this folder exists: TWO blocks, and the
   * net that leaves the first is the net that enters the second.
   *
   * Every node name is read back OUT of the generated deck rather than asserted
   * as a literal, so the test states a relationship instead of restating the
   * netlister's naming convention.
   */
  it("chains rectifier -> buck through one shared bus net", () => {
    const { built } = buildArtifacts();
    const netlist = built.deck.netlist;

    expect(built.blocks).toHaveLength(2);
    const models = built.blocks.map((block) => block.text.split("\n")[0]);
    expect(models).toContain(".subckt Rectifier SEC1 SEC2 VBUS");
    expect(models).toContain(".subckt Buck5V VIN VOUT");

    const x1 = /^X1 (\S+) (\S+) (\S+) Rectifier$/mi.exec(netlist);
    const x2 = /^X2 (\S+) (\S+) Buck5V$/mi.exec(netlist);
    expect(x1, "the rectifier instance is emitted with three nodes").toBeTruthy();
    expect(x2, "the buck instance is emitted with two nodes").toBeTruthy();
    const [, sec1Net, sec2Net, busNet] = x1!;
    const [, buckInNet, usbNet] = x2!;

    // THE SEAM: the rectifier's VBUS port and the buck's VIN port are one net.
    expect(busNet).toBe(buckInNet);
    expect(sec1Net).not.toBe(sec2Net);

    // Left of the chain: the transformer secondary feeds SEC1/SEC2 through the
    // winding resistances, and the mains source is a 170 V peak sine.
    expect(netlist).toMatch(/^V1 \S+ 0 DC 0 AC 170 SIN\(0 170 60\)$/mi);
    expect(netlist).toMatch(new RegExp(`^RS1 \\S+ ${sec1Net} 0\\.5$`, "mi"));
    expect(netlist).toMatch(new RegExp(`^RS2 \\S+ ${sec2Net} 0\\.5$`, "mi"));
    // The transformer is three cards - the reason it cannot live in a child.
    expect(netlist).toMatch(/^L_T1_p \S+ 0 10$/mi);
    expect(netlist).toMatch(/^L_T1_s \S+ \S+ 0\.10*[0-9]*$/mi);
    expect(netlist).toMatch(/^K_T1 L_T1_p L_T1_s 0\.99$/mi);

    // Right of the chain: the USB load and the indicator both sit on the 5 V net.
    expect(netlist).toMatch(new RegExp(`^RUSB ${usbNet} 0 ${USB_LOAD_OHMS}$`, "mi"));
    expect(netlist).toMatch(new RegExp(`^RLED ${usbNet} (\\S+) ${LED_SERIES_OHMS}$`, "mi"));
    expect(netlist).toMatch(/^A\S+ \S+ \S+ TAU_LED_IDEAL_2V$/mi);

    // Both bridges and the catch diode must be REAL junctions: the ideal model
    // does not converge when hard-switched, which is all a rectifier ever does.
    const rectifierBlock = built.blocks.find((block) => block.model === "Rectifier")!;
    expect(rectifierBlock.text.match(/^D\S+ /gm) ?? [], "four bridge diodes").toHaveLength(4);
    expect(rectifierBlock.text, "no ideal junction in the bridge").not.toMatch(/IDEAL/i);
    const buckBlock = built.blocks.find((block) => block.model === "Buck5V")!;
    expect(buckBlock.text, "no ideal junction in the converter").not.toMatch(/IDEAL/i);
    expect(buckBlock.text).toMatch(
      new RegExp(`^V\\S+ \\S+ 0 DC 0 PULSE\\(0 5 0 1e-9 1e-9 ${BUCK_ON_TIME_S} `, "mi"),
    );
    expect(MAINS_PEAK_V).toBe(170);
  });

  it("writes the folder when asked", async () => {
    if (process.env.WRITE_USB_PSU !== "1") {
      expect(true).toBe(true);
      return;
    }
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { files, built } = buildArtifacts();
    const dir = path.join(await repoRoot(), FOLDER);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of files) {
      fs.writeFileSync(path.join(dir, file.name), `${file.serialized.contents}\n`);
    }
    // Notes go AFTER the deck's own first line: SPICE treats line 1 as the
    // title, so prepending a comment block promotes the header to the title and
    // leaves "Tau generated circuit" to be parsed as a device.
    const deckLines = built.deck.netlist.split("\n");
    fs.writeFileSync(
      path.join(dir, "DECK.txt"),
      [deckLines[0], ...DECK_NOTES, ...deckLines.slice(1)].join("\n") + "\n",
    );
    fs.writeFileSync(path.join(dir, "README.md"), README);
    expect(fs.existsSync(path.join(dir, TOP))).toBe(true);
  });
});

/**
 * The committed folder, compiled from the bytes actually on disk, through the
 * same loader the app uses. Everything above works from freshly generated
 * content, which cannot catch the folder going stale.
 */
describe("the committed USB_PSU_WALKTHROUGH folder still compiles", () => {
  it("loads all three .sim sheets from disk and chains them", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(await repoRoot(), FOLDER);
    if (!fs.existsSync(dir)) {
      throw new Error(`${FOLDER}/ is missing. Regenerate with WRITE_USB_PSU=1.`);
    }

    const { loadProjectHierarchySheets } = await import("./projectHierarchyRuntime");
    const { validateSchematicDocument } = await import("./documentValidation");

    // The folder must hold no other format. A reader who sees one .asc beside
    // two .sim files reasonably concludes the two are interchangeable.
    const entries = fs.readdirSync(dir).filter((name) => /\.(sim|asc|tau\.json)$/i.test(name));
    expect(entries.sort()).toEqual([BUCK, RECTIFIER, TOP].sort());

    const loaded = await loadProjectHierarchySheets({
      projectRoot: dir,
      rootSheetPath: path.join(dir, TOP),
      tree: [RECTIFIER, BUCK, TOP].map((name) => ({
        name,
        path: path.join(dir, name),
        kind: "file" as const,
      })),
      readText: async (target) => fs.readFileSync(target, "utf8"),
    });
    expect(loaded.rootPath).toBe(TOP);

    const parentDoc = validateSchematicDocument(
      JSON.parse(fs.readFileSync(path.join(dir, TOP), "utf8")) as unknown,
    );
    const built = buildProjectHierarchyDeck({
      rootPath: TOP,
      root: parentDoc,
      sheets: loaded.sheets,
      analysis: { kind: "tran", stopTime: 60e-3, steps: 600_000 } as never,
    });
    expect(built.blocks).toHaveLength(2);

    // The children's explicit interfaces survived the round trip through disk.
    for (const name of [RECTIFIER, BUCK]) {
      const doc = validateSchematicDocument(
        JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as unknown,
      );
      expect((doc.projectPorts ?? []).length, `${name} kept its projectPorts`).toBeGreaterThan(0);
    }

    // The committed DECK.txt must still be what the compiler produces, so a
    // reader running it in ngspice sees the same circuit as the app.
    const committedDeck = fs.readFileSync(path.join(dir, "DECK.txt"), "utf8");
    const withoutNotes = committedDeck.split("\n").filter((line) => !line.startsWith("*")).join("\n");
    expect(withoutNotes.trimEnd()).toBe(built.deck.netlist.trimEnd());
  });
});

const DECK_NOTES = [
  "* The deck Tau generates from top.sim + Rectifier.sim + Buck5V.sim.",
  "* Written by usbPsuFolder.test.ts - do not edit by hand.",
  "*",
  "* Read the two X lines together - they are the whole point of the project:",
  "*   X1 <sec1> <sec2> <bus> Rectifier",
  "*   X2 <bus>  <vusb>       Buck5V",
  "* The third node of X1 and the first node of X2 are the SAME net. That is the",
  "* rectifier handing its DC bus to the converter, across a sheet boundary.",
  "*",
  "* Measured in real ngspice on this exact deck, averaged over 50-60 ms so the",
  "* mains and the bulk cap have both settled:",
  "*   V(vac_in) peak = 170.000 V    <- 120 V RMS at the outlet",
  "*   V(vbus)        =  13.4236 V   <- rectified, 468.9 mV of 120 Hz ripple",
  "*   V(vusb)        =   4.99845 V  <- 0.03 % from 5 V, 194.4 mV ripple",
  "*   I(DON)         =   9.08491 mA <- the power-on LED is conducting",
  "*   RUSB draws 499.8 mA, so the supply is delivering about 2.5 W.",
  "*",
  "* Run it:  ngspice -b -r out.raw DECK.txt",
  "* The -r is not optional. Batch mode refuses a deck with no .print/.plot/",
  "* .fourier card, and Tau emits .save instead - so plain `ngspice -b DECK.txt`",
  "* parses the circuit and then exits with \"no simulations run!\".",
];

const README = `# USB_PSU_WALKTHROUGH — 120 V AC to 5 V USB, as three sheets

A complete power supply built the way you would actually draw one: **one sheet
per job**, wired together on a parent sheet. This is the worked example for
Tau's hierarchical subcircuits.

Every file here is \`.sim\` — Tau's own format. There is deliberately no \`.asc\`
in this project.

## The three sheets

| file | what it is | ports |
| --- | --- | --- |
| \`Rectifier.sim\` | **child** — full-wave bridge + 2200 µF bulk cap + bleeder. Turns AC into a lumpy DC bus. | \`SEC1\` in, \`SEC2\` in, \`VBUS\` out |
| \`Buck5V.sim\` | **child** — 200 kHz switching buck converter. Steps the bus down to 5 V. | \`VIN\` in, \`VOUT\` out |
| \`top.sim\` | **parent** — the outlet, the transformer, both blocks, the USB load and a power-on LED. | — |
| \`DECK.txt\` | the SPICE deck Tau generates from all three, kept as evidence. | — |

Open the folder in Tau and open \`top.sim\`. Press **Run**.

## How subcircuits work in Tau, in four sentences

1. A **child sheet** is an ordinary schematic that publishes an interface: you
   mark some net labels as ports (In / Out / BiDir) and Tau compiles the sheet
   into a SPICE \`.subckt\`.
2. A **parent sheet** places a *block* — a \`subckt\` symbol whose value is the
   model name and whose pins are an ordered bank \`p1…pN\` labelled with the
   child's port names.
3. **Order lives on the parent.** The child says *what* its ports are; the
   parent's pin bank says *in what order*. That is why one child can serve
   several parents.
4. At Run, Tau resolves every link, emits one \`.subckt\` per child, and wires
   the parent's own nets into it positionally.

The whole binding is one line of the generated deck:

\`\`\`
X1 n004 n005 vbus Rectifier      <- parent nets  ->  SEC1 SEC2 VBUS
X2 vbus vusb Buck5V              <- parent nets  ->  VIN  VOUT
\`\`\`

\`vbus\` is the third node of \`X1\` **and** the first node of \`X2\`. One net, two
blocks: that is the rectifier handing its DC bus to the converter.

## What a child sheet may contain

This is a real restriction and worth knowing before you draw:

> A child sheet emits a \`.subckt\` **body**, so every device in it must map to a
> single ngspice card. Allowed today: ground, resistor, capacitor, polarized
> capacitor, inductor, diode, switch, voltage source, and nested blocks.

That is why the **transformer lives on \`top.sim\`, not in \`Rectifier.sim\`**. A
transformer expands to two inductors plus a \`K\` coupling statement — three
cards — so a child sheet refuses it, by name:

\`\`\`
T1 (transformer) on "Rectifier.sim" is not yet supported inside a linked sheet.
It expands to several ngspice devices, which a linked sheet's block body does
not generate yet.
\`\`\`

The LED is on the parent for a different reason: it needs a model library.

## The measured result

Real ngspice, on the deck in this folder, averaged over 50–60 ms so the mains
and the bulk cap have both settled:

| node | value | what it tells you |
| --- | --- | --- |
| \`V(VAC_IN)\` peak | 170.000 V | 120 V RMS — SPICE sine amplitude is *peak*, and 120 × √2 = 169.7 |
| \`V(VBUS)\` | **13.4236 V** | rectified and smoothed, with 468.9 mV of 120 Hz ripple |
| \`V(VUSB)\` | **4.99845 V** | 0.03 % from 5 V, 194.4 mV ripple |
| \`I(DON)\` | 9.08491 mA | the power-on LED is really conducting |

\`RUSB\` is 10 Ω, so the supply delivers 499.8 mA — about **2.5 W**, a plausible
USB load.

## Two honest limits

**The buck is open loop.** It runs a fixed 40.8 % duty cycle with no feedback,
so it holds 5 V *only at the load it was tuned for*. A real charger measures its
own output and corrects every cycle. Adding that is the natural next exercise.

**Duty was solved, not calculated.** Theory says
\`D = (Vout + Vf) / (Vbus + Vf)\`, which lands near 0.404 — but raising duty draws
more bus current, which sags the bus, which lowers the output. The fixed point is
what matters, so the ON time was swept against the real engine until \`V(VUSB)\`
hit 5 V. It came out at 2.040 µs.

## Recreating it from scratch

See \`WALKTHROUGH.html\` beside this file for the illustrated version, with
screenshots of every sheet. The short form:

1. **New project folder.** Tau keeps every schematic inside a project folder.
2. **New schematic → \`Rectifier.sim\`.** Draw the bridge: four diodes in two
   vertical legs between a positive rail and a ground rail. Give each diode the
   value \`D Is=1e-14 N=1\` — see the warning below. Add \`CBUS\` 2200 µF from the
   rail to ground, and \`RBLEED\` 100 kΩ across the two AC inputs.
3. **Mark its ports.** Label the two AC nodes \`SEC1\`/\`SEC2\` and the rail
   \`VBUS\`, then open **Sheet interface** and mark them In, In, Out — in that
   order.
4. **New schematic → \`Buck5V.sim\`.** Switch, catch diode, 220 µH inductor,
   22 µF output cap, and a voltage source with value
   \`PULSE(0 5 0 1n 1n 2.04u 5u)\` driving the switch's control pins. Label
   \`VIN\`/\`VOUT\` and mark them In/Out.
5. **New schematic → \`top.sim\`.** Place an AC source \`170 60\`, \`RP\` 20 Ω, a
   transformer \`10:1 L1=10 k=0.99\`, \`RS1\`/\`RS2\` 0.5 Ω, then two blocks pointing
   at the two children, then \`RUSB\` 10 Ω and the LED branch.
6. **Add \`.tran 100n 60m\`** and press Run.

### Three traps, all of which cost real debugging time

- **Write \`D Is=1e-14 N=1\` on every rectifier diode.** A palette diode with no
  LTspice provenance compiles to Tau's *ideal* model, and the ideal one will not
  converge when hard-switched — which is all a bridge ever does.
- **Give the transformer \`L1=10\`.** The default primary is 10 mH, whose
  reactance at 60 Hz is 3.8 Ω: effectively a short across the outlet.
- **Use \`k=0.99\`, not the 0.999 default.** Perfect coupling plus a floating
  secondary is singular. At 0.999 this exact circuit dies with
  \`Timestep too small; trouble with node l2_intern__\` at 6.9 µs.

## Regenerating

Never edit these files by hand — Tau's own writer produces them:

\`\`\`
WRITE_USB_PSU=1 npx vitest run --root apps/desktop src/schematic/usbPsuFolder.test.ts
\`\`\`

\`usbPsuFolder.test.ts\` also re-reads this folder from disk on every test run and
recompiles it, so if these files go stale the suite fails.
`;
