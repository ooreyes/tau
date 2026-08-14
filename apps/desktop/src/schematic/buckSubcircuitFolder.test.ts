/**
 * Writes (and verifies) the SUBCRKT proof folder.
 *
 * The folder is a deliverable a human opens in Tau, so it must be produced by
 * Tau's OWN writers - `schematicToAsc` for the child, `serializeSchematicFile`
 * for the parent - rather than by hand-rolled text. Hand-written files can be
 * subtly unopenable in ways a passing test would never notice.
 *
 * The circuit comes from `buckSubcircuitFixture`, the same source the proof gate
 * uses, so the files on disk cannot drift from the circuit under test.
 *
 * By default this test only ASSERTS. Set `WRITE_SUBCRKT=1` to also write the
 * folder, so a normal test run never touches the working tree:
 *
 *   WRITE_SUBCRKT=1 npx vitest run --root apps/desktop \
 *     src/schematic/buckSubcircuitFolder.test.ts
 */
import { describe, expect, it } from "vitest";
import { buckChildSheet, topSheet } from "./buckSubcircuitFixture";
import { buildProjectHierarchyDeck } from "./projectHierarchy";
import { schematicToAsc } from "../io/ascExport";
import { serializeSchematicFile } from "../project/types";

/** Repo-root-relative output folder. */
const FOLDER = "SUBCRKT";
/** Fixed so re-running the generator produces no spurious diff. */
const SAVED_AT = "2026-08-14T00:00:00.000Z";

const CHILD_NAME = "Buck25to5.asc";
const PARENT_NAME = "top.sim";

function buildArtifacts() {
  const child = buckChildSheet();
  const parent = topSheet(CHILD_NAME);

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
    // 20 ns steps over 5 ms. The step matters for the SHIPPED deck: at the
    // default resolution the emitted `.tran` had about two points per 5 us
    // switching cycle, so a reader running DECK.txt would measure noise rather
    // than the converter.
    analysis: { kind: "tran", stopTime: 5e-3, steps: 250_000 } as never,
  });
  return { child, parent, childAsc, parentSim, built };
}

describe("the SUBCRKT proof folder", () => {
  it("produces a child .asc that Tau's own exporter is willing to write", () => {
    const { childAsc } = buildArtifacts();
    // Only lossy-carrier notices are acceptable. Anything else is a blocking
    // save problem, which would mean a user could open this file but not save it.
    const blocking = childAsc.warnings.filter(
      (warning) => !warning.includes("saved as a placeholder resistor"),
    );
    expect(blocking, `unexpected blocking export warnings: ${blocking.join(" | ")}`).toEqual([]);
    // The two hierarchy ports, as LTspice records.
    expect(childAsc.text).toContain("IOPIN 192 128 In");
    expect(childAsc.text).toContain("IOPIN 480 128 Out");
    // The switch is a Tau-native part with no faithful LTspice symbol, so it
    // persists as a carrier resistor plus `Tau*` metadata. Assert the metadata
    // is really there - without it the part would come back as a resistor and
    // the converter would silently stop switching.
    expect(childAsc.text).toContain("SYMATTR TauKind switch");
  });

  it("produces a parent .sim that carries the link", () => {
    const { parentSim } = buildArtifacts();
    expect(parentSim.warnings).toEqual([]);
    const parsed = JSON.parse(parentSim.contents) as {
      app: string;
      components: { projectSubcircuit?: { sheetPath: string; model: string; ports: string[] } }[];
    };
    expect(parsed.app).toBe("Tau");
    const link = parsed.components.find((component) => component.projectSubcircuit)?.projectSubcircuit;
    expect(link).toEqual({ sheetPath: CHILD_NAME, model: "Buck25to5", ports: ["VIN", "VOUT"] });
  });

  it("compiles to a deck whose block is the buck and whose load is 1k", () => {
    const { built } = buildArtifacts();
    expect(built.blocks[0].text.split("\n")[0]).toBe(".subckt Buck25to5 VIN VOUT");
    expect(built.deck.netlist).toMatch(/^V1 \S+ 0 DC 25$/mi);
    expect(built.deck.netlist).toMatch(/^RLOAD \S+ 0 1000$/mi);
    expect(built.deck.netlist).toMatch(/^X1 \S+ \S+ Buck25to5$/mi);
  });

  it("writes the folder when asked", async () => {
    if (process.env.WRITE_SUBCRKT !== "1") {
      expect(true).toBe(true);
      return;
    }
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { childAsc, parentSim, built } = buildArtifacts();
    // Find the repo root by walking up for its workspace marker. Counting `..`
    // from `process.cwd()` guessed wrong and wrote the folder OUTSIDE the repo,
    // because cwd is wherever the runner was invoked, not the vitest root.
    let root = process.cwd();
    while (!fs.existsSync(path.join(root, "pnpm-workspace.yaml"))) {
      const up = path.dirname(root);
      if (up === root) throw new Error("could not locate the repo root (no pnpm-workspace.yaml above cwd)");
      root = up;
    }
    const dir = path.join(root, FOLDER);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, CHILD_NAME), childAsc.text);
    fs.writeFileSync(path.join(dir, PARENT_NAME), `${parentSim.contents}\n`);
    // The notes go AFTER the deck's own first line, never before it. SPICE
    // treats line 1 as the title, so prepending a comment block promoted the
    // header to the title and left "Tau generated circuit" to be parsed as a
    // device - which made the shipped deck fail with "incomplete or empty
    // netlist" even though the circuit was fine.
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
 * The committed folder, compiled from the bytes actually on disk.
 *
 * Everything above works from freshly generated content, which cannot catch the
 * folder going stale. This reads the real files through the real loader - the
 * same path the app uses - so if someone edits `Buck25to5.asc` by hand, or the
 * exporter changes and the folder is not regenerated, this fails.
 */
describe("the committed SUBCRKT folder still compiles", () => {
  it("loads the .asc child and the .sim parent from disk and builds the block", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    let root = process.cwd();
    while (!fs.existsSync(path.join(root, "pnpm-workspace.yaml"))) {
      const up = path.dirname(root);
      if (up === root) throw new Error("could not locate the repo root");
      root = up;
    }
    const dir = path.join(root, FOLDER);
    if (!fs.existsSync(dir)) {
      // The folder is a deliverable, not a build output - if it is absent, say
      // so plainly rather than passing quietly.
      throw new Error(`${FOLDER}/ is missing. Regenerate with WRITE_SUBCRKT=1.`);
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
    const childSheet = loaded.sheets.find((entry) => entry.path === CHILD_NAME);
    expect(childSheet, "the .asc child loaded from disk").toBeDefined();

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
    // The devices that make it a converter, from the on-disk .asc.
    expect(built.blocks[0].text, "switch").toMatch(/^S\S+ /m);
    // One `D` line, naming a real Shockley model. The ideal junction would emit
    // TWO lines here (the device plus a zero-volt sense source) and a model card
    // spelled `..._IDEAL_...`, and that ideal model is the one that fails to
    // converge in a hard-switched converter - so this assertion is really
    // checking that the on-disk sheet did not quietly become the ideal variant.
    expect(built.blocks[0].text, "catch diode is a real junction, on one line").toMatch(
      /^D\S+ \S+ \S+ TAU_DIODE\S*$/m,
    );
    expect(built.blocks[0].text, "no ideal-junction model card").not.toMatch(/IDEAL/i);
    expect(built.blocks[0].text.match(/^D\S+ /gm) ?? [], "exactly one diode line").toHaveLength(1);
    expect(built.blocks[0].text, "gate drive").toMatch(/PULSE\(0 5 /);
    expect(built.blocks[0].text, "inductor").toMatch(/^L\S+ \S+ \S+ 0\.0047$/m);
    // And the committed DECK.txt must still be what the compiler produces, so a
    // reader running `ngspice -b DECK.txt` sees the same circuit as the app.
    const committedDeck = fs.readFileSync(path.join(dir, "DECK.txt"), "utf8");
    const withoutNotes = committedDeck.split("\n").filter((line) => !line.startsWith("*")).join("\n");
    expect(withoutNotes.trimEnd()).toBe(built.deck.netlist.trimEnd());
  });
});

const DECK_NOTES = [
  "* The deck Tau generates from top.sim + Buck25to5.asc.",
  "* Written by buckSubcircuitFolder.test.ts - do not edit by hand.",
  "*",
  "* The .subckt body below was compiled from the LINKED .asc sheet.",
  "* Measured in ngspice on this exact deck: V(out) = 5.00316 V into 1 k,",
  "* 6.06 mV ripple, 5.855 V startup peak.",
  "*",
  "* Runnable as-is:  ngspice -b DECK.txt",
];

const README = `# SUBCRKT — a buck converter as a subcircuit

This folder proves the child-subcircuit feature end to end, with an \`.asc\`
child sheet.

## What's here

| file | what it is |
| --- | --- |
| \`Buck25to5.asc\` | The **child sheet**: a 25 V → 5 V buck converter. An ordinary LTspice \`.asc\`. Its two public pins are the net labels \`VIN\` and \`VOUT\`, marked as hierarchy ports (\`IOPIN\`). |
| \`top.sim\` | The **parent sheet**: a 25 V source → the buck block → a 1 kΩ load. |
| \`DECK.txt\` | The SPICE deck Tau generates from the pair, kept as evidence. |

## Try it

1. Open this folder as a project in Tau.
2. Open \`top.sim\`. The block in the middle is \`Buck25to5\`, pointing at the
   \`.asc\` beside it.
3. Press **Run**. \`V(out)\` settles at **5.00 V**.
4. Double-click the block to open the child sheet and see the converter inside.

## The numbers, and why they are what they are

Measured in ngspice on the deck in \`DECK.txt\`:

| quantity | value |
| --- | --- |
| **V(out)** | **5.003 V** (target 5.000 V, +0.06 %) |
| output ripple | 6.06 mV pk-pk |
| startup peak | 5.855 V |
| load current | 5.00 mA |

A 1 kΩ load at 5 V draws only 5 mA, which is a very light load for a buck, and
that one fact drives every component value:

- **Duty is 22.14 %, not 20 %.** The textbook \`D = Vout/Vin\` ignores the catch
  diode's forward drop. The real relation is \`D = (Vout+Vf)/(Vin+Vf)\` =
  5.7/25.7. At \`D = 0.2\` this same circuit measures **4.44 V** — an 11 % error.
- **L = 4.7 mH** keeps it in continuous conduction at 5 mA. The ripple current is
  \`(Vin−Vout)·ton/L\` = 4.7 mA, so the inductor current never reaches zero
  (minimum 2.65 mA). In discontinuous conduction \`Vout\` would not equal
  \`D·Vin\` at all.
- **RD + CD is a damping branch**, not decoration. Open-loop at a light load the
  LC filter is very high-Q and the output rings to ~9.5 V on startup. This branch
  pulls that to 5.86 V at **zero** DC cost, because no DC current flows through a
  capacitor.
- **200 kHz over 5 ms** is 1000 switching cycles, which fits the solver's step
  budget.

## Notes

- The parent is \`.sim\` rather than \`.asc\` on purpose. LTspice's format cannot
  persist a subcircuit link — it has nowhere to record the child's path, the
  model name, or the pin order — so Tau refuses to write one instead of silently
  dropping it. A \`.asc\` is a fine **child**; it cannot be the sheet that owns
  the link.
- Inside \`Buck25to5.asc\`, the switch is stored as a placeholder resistor plus
  \`SYMATTR TauKind switch\`. Tau restores it exactly; LTspice can still open the
  file rather than choking on an unknown symbol.
- The catch diode's value spells its junction, \`D Is=1e-14 N=1\`, instead of a
  bare \`D\`. A bare \`D\` resolves to Tau's textbook *ideal* junction unless the
  part carries LTspice provenance — and provenance does not survive a \`.asc\`
  round trip, so the same diode would be real in memory and ideal after a
  reload. That matters here because the ideal junction does not converge in a
  hard-switched converter. (It aborts the same way in a flat circuit with no
  subcircuit at all, so that limitation is unrelated to hierarchy.)

Regenerate with:

\`\`\`
WRITE_SUBCRKT=1 npx vitest run --root apps/desktop src/schematic/buckSubcircuitFolder.test.ts
\`\`\`
`;
