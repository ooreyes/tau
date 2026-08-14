/**
 * The buck-converter proof for project-linked child sheets.
 *
 * This is the SUBCRKT deliverable expressed as a test, so the claim "a
 * subcircuit block can be a real switching converter" is checked by the gate
 * rather than by a screenshot. It builds two sheets in Tau's own document form:
 *
 *   Buck25to5.asc  - a 25 V -> 5 V synchronous-less buck, exposed as a two-port
 *                    block (VIN, VOUT). Ground is the global node 0.
 *   top.asc        - 25 V source -> the block -> a 1 k load resistor.
 *
 * The reference design was validated independently in real ngspice before any
 * of this existed: V(out) = 5.003 V, 6.06 mV ripple, 5.86 V startup peak. The
 * duty is deliberately NOT 5/25: it compensates the real catch-diode drop,
 * D = (Vout+Vf)/(Vin+Vf) = 5.7/25.7 = 0.2214. At D = 0.2 the same circuit
 * measures 4.44 V, which is an 11 % error - so the compensation is load-bearing.
 *
 * A 1 k load at 5 V is only 5 mA, which is a very light load for a buck. Two
 * consequences drive the component values, and both are checked below:
 *   - CCM needs dIL < 2*Iout = 10 mA, hence L = 4.7 mH (dIL = 4.7 mA).
 *   - The LC is otherwise very high-Q, so an Rd+Cd damping branch tames the
 *     open-loop startup overshoot (9.5 V -> 5.86 V) at zero DC cost, because no
 *     DC current flows through a capacitor.
 */
import { describe, expect, it } from "vitest";
import { extractCircuit } from "./netlist";
import { getComponentPins } from "./pins";
import { buildProjectHierarchyDeck, childDeviceDisposition, ProjectHierarchyError } from "./projectHierarchy";
import { loadProjectHierarchySheets } from "./projectHierarchyRuntime";
import { canonicalProjectOwnerPath, canonicalProjectSheetPath } from "./projectSubcircuit";
import { schematicToAsc } from "../io/ascExport";
import { importAsc } from "../io/ascImport";
import type { NetLabel, SchematicComponent, SchematicWire } from "./types";

/** Switching period and on-time, in seconds, for the validated design. */
const PERIOD_S = 5e-6;
const ON_TIME_S = 1.107e-6;
const PWM_VALUE = `PULSE(0 5 0 1n 1n ${ON_TIME_S * 1e6}u ${PERIOD_S * 1e6}u)`;

type Doc = {
  components: SchematicComponent[];
  wires: SchematicWire[];
  netLabels: NetLabel[];
  directives?: string[];
};

const part = (
  id: string,
  kind: SchematicComponent["kind"],
  x: number,
  y: number,
  value: string,
  label: string,
  rotation: 0 | 90 | 180 | 270 = 0,
): SchematicComponent => ({ id, kind, x, y, rotation, value, label }) as SchematicComponent;

const wire = (id: string, ...points: [number, number][]): SchematicWire => ({
  id,
  points: points.map(([x, y]) => ({ x, y })),
});

/**
 * The child sheet. Laid out as a left-to-right power path so a human opening
 * it reads VIN -> switch -> SW node -> inductor -> VOUT, with the returns
 * dropping to ground symbols underneath.
 */
function buckChildSheet(): Doc {
  const components: SchematicComponent[] = [
    // Power path. Tau's two-terminal parts are horizontal at rotation 0.
    part("s1", "switch", 256, 128, "TAU_SW", "S1"),
    part("l1", "inductor", 384, 128, "4.7m", "L1"),
    // Catch diode: rotation 270 maps (x,y)->(y,-x), which puts K above and A
    // below, so the arrow points up from ground into the SW node.
    //
    // `ltSymbolType` is not decoration - it is what this sheet really is. The
    // deliverable is a `.asc`, so every part in it carries LTspice provenance,
    // and for a junction that provenance decides the MODEL: a part read from a
    // `.asc` keeps its real Shockley junction, while a part placed natively in
    // Tau gets the textbook ideal one. Building the fixture without it would
    // test a different circuit than the file on disk - and specifically the one
    // that does not converge here (see the note at the foot of this file).
    { ...part("d1", "diode", 320, 192, "D", "D1", 270), ltSymbolType: "diode" } as SchematicComponent,
    // Gate drive. A source is vertical at rotation 0 (p above, n below).
    part("vpwm", "vsource", 176, 208, PWM_VALUE, "VPWM"),
    // Output filter capacitor, and the Rd+Cd damping branch beside it.
    part("c1", "capacitor", 480, 192, "0.5u", "C1", 90),
    part("rd", "resistor", 576, 176, "100", "RD", 90),
    part("cd", "capacitor", 576, 272, "10u", "CD", 90),
    // Ground symbols, one under each return.
    part("g1", "ground", 320, 256, "", ""),
    part("g2", "ground", 176, 272, "", ""),
    part("g3", "ground", 272, 256, "", ""),
    part("g4", "ground", 480, 256, "", ""),
    part("g5", "ground", 576, 336, "", ""),
  ];
  const wires: SchematicWire[] = [
    // VIN into the switch.
    wire("w-vin", [192, 128], [224, 128]),
    // SW node, split at x=320 so the diode's wire meets a real endpoint
    // instead of forming a mid-segment T junction.
    wire("w-sw-a", [288, 128], [320, 128]),
    wire("w-sw-b", [320, 128], [352, 128]),
    wire("w-d-k", [320, 160], [320, 128]),
    wire("w-d-a", [320, 224], [320, 256]),
    // Gate drive up and across to the switch's NC+ control pin.
    wire("w-gate", [176, 176], [176, 160], [240, 160]),
    wire("w-pwm-gnd", [176, 240], [176, 272]),
    // The switch's NC- control pin returns to ground.
    wire("w-nc-gnd", [272, 160], [272, 256]),
    // Inductor out to VOUT, split so the filter taps meet endpoints.
    wire("w-vout-a", [416, 128], [480, 128]),
    wire("w-vout-b", [480, 128], [576, 128]),
    wire("w-c1-top", [480, 128], [480, 160]),
    wire("w-c1-gnd", [480, 224], [480, 256]),
    wire("w-rd-top", [576, 128], [576, 144]),
    wire("w-rd-cd", [576, 208], [576, 240]),
    wire("w-cd-gnd", [576, 304], [576, 336]),
  ];
  // The two public ports. `port` is what serialises to an LTspice IOPIN.
  const netLabels: NetLabel[] = [
    { id: "n-vin", x: 192, y: 128, text: "VIN", port: "In" },
    { id: "n-vout", x: 480, y: 128, text: "VOUT", port: "Out" },
  ];
  return { components, wires, netLabels };
}

/**
 * The parent sheet: 25 V in, the block, a 1 k load.
 *
 * `childPath` is a parameter only so the baseline block at the bottom of this
 * file can re-run the identical circuit under the currently-accepted `.sim`
 * extension and isolate the second refusal from the first. Real callers use the
 * default.
 */
function topSheet(childPath = "Buck25to5.asc"): Doc {
  const components: SchematicComponent[] = [
    part("v1", "vsource", 128, 208, "25", "V1"),
    part("rload", "resistor", 512, 208, "1k", "RLOAD", 90),
    part("gv", "ground", 128, 288, "", ""),
    part("gr", "ground", 512, 288, "", ""),
    {
      ...part("x1", "subckt", 320, 176, "Buck25to5", "X1"),
      // The ordered p1..pN bank the block contract requires. The ORDER lives
      // here, on the parent, which is why the child needs no ordering field.
      pinOverride: [
        { id: "p1", label: "VIN", x: 272, y: 176 },
        { id: "p2", label: "VOUT", x: 368, y: 176 },
      ],
      projectSubcircuit: {
        sheetPath: childPath,
        model: "Buck25to5",
        ports: ["VIN", "VOUT"],
      },
    } as SchematicComponent,
  ];
  const wires: SchematicWire[] = [
    wire("t-in", [128, 176], [272, 176]),
    wire("t-out-a", [368, 176], [440, 176]),
    wire("t-out-b", [440, 176], [512, 176]),
    wire("t-v-gnd", [128, 240], [128, 288]),
    wire("t-r-gnd", [512, 240], [512, 288]),
  ];
  const netLabels: NetLabel[] = [{ id: "t-out", x: 440, y: 176, text: "OUT" }];
  return { components, wires, netLabels, directives: [".tran 20n 5m"] };
}

/** Net id carrying a given component pin, for connectivity assertions. */
function netOfPin(doc: Doc, componentId: string, pinId: string): string {
  const circuit = extractCircuit(doc.components, doc.wires, doc.netLabels);
  const entry = circuit.components.find((c) => c.component.id === componentId);
  expect(entry, `component ${componentId} was extracted`).toBeDefined();
  const net = entry!.pins[pinId];
  expect(net, `${componentId}.${pinId} reaches a net`).toBeTruthy();
  return net;
}

describe("buck converter as a project-linked child sheet", () => {
  it("wires the child sheet into the topology the reference deck assumes", () => {
    const child = buckChildSheet();
    // Every pin of every part must land on a net; a stranded pin means the
    // layout drifted from the wire list.
    const circuit = extractCircuit(child.components, child.wires, child.netLabels);
    for (const entry of circuit.components) {
      for (const pin of getComponentPins(entry.component)) {
        expect(
          entry.pins[pin.id],
          `${entry.component.label || entry.component.kind}.${pin.id} is wired`,
        ).toBeTruthy();
      }
    }

    // The buck's defining connections.
    const sw = netOfPin(child, "s1", "b");
    expect(netOfPin(child, "d1", "k"), "catch diode cathode sits on the SW node").toBe(sw);
    expect(netOfPin(child, "l1", "a"), "inductor input sits on the SW node").toBe(sw);
    const vout = netOfPin(child, "l1", "b");
    expect(netOfPin(child, "c1", "a"), "output cap taps VOUT").toBe(vout);
    expect(netOfPin(child, "rd", "a"), "damping branch taps VOUT").toBe(vout);
    expect(netOfPin(child, "rd", "b"), "damping R feeds damping C").toBe(netOfPin(child, "cd", "a"));
    // The gate drive controls the switch, referenced to ground.
    expect(netOfPin(child, "vpwm", "p"), "PWM drives the switch NC+ pin").toBe(
      netOfPin(child, "s1", "cp"),
    );
    const groundNet = circuit.nets.find((n) => n.isGround)?.id;
    expect(groundNet, "the child has a ground reference").toBeTruthy();
    expect(netOfPin(child, "s1", "cn"), "switch NC- returns to ground").toBe(groundNet);
    expect(netOfPin(child, "d1", "a"), "catch diode anode returns to ground").toBe(groundNet);
    expect(netOfPin(child, "cd", "b"), "damping C returns to ground").toBe(groundNet);
  });

  it("declares exactly the two ports the parent block contracts for", () => {
    const child = buckChildSheet();
    const ports = child.netLabels.filter((label) => label.port);
    expect(ports.map((p) => [p.text, p.port])).toEqual([
      ["VIN", "In"],
      ["VOUT", "Out"],
    ]);
    // Ports must be on different electrical nets, or the block is shorted.
    const circuit = extractCircuit(child.components, child.wires, child.netLabels);
    const vinNet = netOfPin(child, "s1", "a");
    const voutNet = netOfPin(child, "l1", "b");
    expect(vinNet).not.toBe(voutNet);
    expect(circuit.nets.find((n) => n.id === vinNet)?.isGround ?? false).toBe(false);
  });

  it("survives a .asc export/re-import round trip with its ports intact", () => {
    const child = buckChildSheet();
    const exported = schematicToAsc({
      components: child.components,
      wires: child.wires,
      netLabels: child.netLabels,
    });
    // The hierarchy ports must be present as LTspice IOPIN records - this is
    // the mechanism that lets a .asc child declare its interface at all.
    expect(exported.text).toContain("IOPIN 192 128 In");
    expect(exported.text).toContain("IOPIN 480 128 Out");

    const reimported = importAsc(exported.text);
    const backPorts = (reimported.netLabels ?? []).filter((label) => label.port);
    expect(backPorts.map((p) => [p.text, p.port])).toEqual([
      ["VIN", "In"],
      ["VOUT", "Out"],
    ]);
    // And the topology must come back identical, or the file is not a faithful
    // carrier for this circuit.
    const back: Doc = {
      components: reimported.components,
      wires: reimported.wires,
      netLabels: reimported.netLabels ?? [],
    };
    const findBack = (label: string) =>
      back.components.find((c) => (c.label || "").toUpperCase() === label);
    for (const label of ["S1", "L1", "D1", "VPWM", "C1", "RD", "CD"]) {
      expect(findBack(label), `${label} survived the round trip`).toBeDefined();
    }
  });

  it("compiles the linked pair into a deck whose block is the buck", () => {
    const child = buckChildSheet();
    const top = topSheet();
    const built = buildProjectHierarchyDeck({
      rootPath: "top.asc",
      root: top as never,
      sheets: [{ path: "Buck25to5.asc", document: child as never }],
      analysis: { kind: "tran", stopTime: 5e-3, steps: 2000 } as never,
    });
    expect(built.blocks).toHaveLength(1);
    const block = built.blocks[0];
    expect(block.model).toBe("Buck25to5");
    // The interface line, exactly: two ports in the parent's declared order.
    expect(block.text.split("\n")[0]).toBe(".subckt Buck25to5 VIN VOUT");
    expect(block.text.trimEnd().endsWith(".ends Buck25to5")).toBe(true);
    // Every active device must be present. This is the assertion that fails
    // today: the child compiler only knows ground/R/C/L/subckt.
    expect(block.text, "the switch is emitted").toMatch(/^S\S+ /m);
    expect(block.text, "the catch diode is emitted").toMatch(/^D\S+ /m);
    expect(block.text, "the gate-drive source is emitted").toMatch(/^V\S+ .*PULSE/mi);
    expect(block.text, "the inductor is emitted").toMatch(/^L\S+ /m);
    // The parent instantiates the block against a 25 V rail and a 1 k load.
    expect(built.deck.netlist).toMatch(/^X\S+ \S+ \S+ Buck25to5$/mi);
    expect(built.deck.netlist).toMatch(/^V1 .*25/mi);
    expect(built.deck.netlist).toMatch(/^RLOAD .*1000$/mi);
  });
});

/**
 * The `.asc` half of the feature, proven on a passive child so it stands on its
 * own regardless of which devices the child compiler accepts.
 *
 * The child here is an RC divider that declares VIN/VOUT/GND using ONLY the
 * mechanism a `.asc` file has - net labels carrying an `IOPIN` direction - with
 * no `projectPorts` array anywhere. Its labels are deliberately declared in a
 * different order from the parent's pin bank, because that is the case which
 * decides whether the design is sound: an `.asc` cannot record port order, so
 * the order must come from the parent, and a compiler that trusted flag order
 * would silently wire this block's pins to the wrong nets.
 */
describe("a .asc child sheet declares its interface with IOPIN markers alone", () => {
  /** Passive RC child, ports declared out of order on purpose. */
  const rcChild = () => ({
    components: [
      part("r1", "resistor", 256, 128, "1k", "R1"),
      part("c1", "capacitor", 384, 192, "100n", "C1", 90),
      part("g1", "ground", 384, 288, "", ""),
    ],
    wires: [
      wire("w-in", [192, 128], [224, 128]),
      wire("w-mid", [288, 128], [384, 128]),
      wire("w-c-top", [384, 128], [384, 160]),
      wire("w-c-gnd", [384, 224], [384, 288]),
    ],
    // Reverse of the parent's declared order (VIN, VOUT), to prove flag order
    // is not what fixes the contract.
    netLabels: [
      { id: "n-vout", x: 384, y: 128, text: "VOUT", port: "Out" },
      { id: "n-vin", x: 192, y: 128, text: "VIN", port: "In" },
    ] as NetLabel[],
  });

  const rcParent = (ports: string[]) => ({
    components: [
      part("v1", "vsource", 128, 208, "5", "V1"),
      part("gv", "ground", 128, 288, "", ""),
      {
        ...part("x1", "subckt", 320, 176, "TauRC", "X1"),
        pinOverride: ports.map((name, index) => ({
          id: `p${index + 1}`,
          label: name,
          x: index === 0 ? 272 : 368,
          y: 176,
        })),
        projectSubcircuit: { sheetPath: "rc.asc", model: "TauRC", ports },
      } as SchematicComponent,
    ],
    wires: [wire("t-in", [128, 176], [272, 176]), wire("t-gnd", [128, 240], [128, 288])],
    netLabels: [] as NetLabel[],
    directives: [".tran 1m"],
  });

  const compile = (ports: string[]) =>
    buildProjectHierarchyDeck({
      rootPath: "top.asc",
      root: rcParent(ports) as never,
      sheets: [{ path: "rc.asc", document: rcChild() as never }],
      analysis: { kind: "tran", stopTime: 1e-3, steps: 500 } as never,
    });

  it("compiles a .asc child with no projectPorts array at all", () => {
    const built = compile(["VIN", "VOUT"]);
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0].sheetPath).toBe("rc.asc");
  });

  it("orders the .subckt header by the parent's bank, not by flag order", () => {
    // The child lists VOUT before VIN. The header must still follow the parent.
    expect(compile(["VIN", "VOUT"]).blocks[0].text.split("\n")[0]).toBe(".subckt TauRC VIN VOUT");
    // And when the parent genuinely declares the other order, the header follows
    // that instead - so this is really reading the parent, not sorting by luck.
    expect(compile(["VOUT", "VIN"]).blocks[0].text.split("\n")[0]).toBe(".subckt TauRC VOUT VIN");
  });

  it("still refuses when the parent names a port the child never declared", () => {
    let code = "";
    try {
      compile(["VIN", "VBIAS"]);
    } catch (error) {
      code = (error as ProjectHierarchyError).code;
    }
    // Derivation must not paper over a real disagreement.
    expect(code).toBe("invalid-contract");
  });
});

/**
 * A `.asc` is a legal link TARGET and an illegal link OWNER, and the two need
 * separate path grammars. Widening the single grammar looked sufficient and was
 * not: the same function governs the ROOT resolver, so an `.asc` root started
 * resolving, its written refusal stopped firing, and the sheet enumerator then
 * dropped that same file - one clear sentence became an incoherent failure.
 *
 * The reachability half matters just as much. The compiler accepting `.asc` is
 * worth nothing if the runtime loader never hands it one, which is exactly what
 * a `.sim`-only enumerator did. These tests drive the real loader, not the
 * compiler directly, because that is the layer the app actually calls.
 */
describe("a .asc may be a linked child but never the sheet that owns links", () => {
  it("accepts .asc as a link target and refuses it as a link owner", () => {
    expect(canonicalProjectSheetPath("blocks/Buck25to5.asc")).toBe("blocks/Buck25to5.asc");
    expect(canonicalProjectOwnerPath("blocks/Buck25to5.asc")).toBeNull();
    // The owner grammar is otherwise the target grammar, unchanged.
    expect(canonicalProjectOwnerPath("top.sim")).toBe("top.sim");
    expect(canonicalProjectOwnerPath("top.tau.json")).toBe("top.tau.json");
    expect(canonicalProjectOwnerPath("../escape.sim")).toBeNull();
  });

  const tree = [
    { name: "top.sim", path: "/proj/top.sim", kind: "file" as const },
    { name: "Buck25to5.asc", path: "/proj/Buck25to5.asc", kind: "file" as const },
  ];

  it("refuses a .asc root with the sentence that names the supported formats", async () => {
    await expect(
      loadProjectHierarchySheets({
        projectRoot: "/proj",
        rootSheetPath: "/proj/Buck25to5.asc",
        tree,
        readText: async () => "",
      }),
    ).rejects.toThrow(/must be saved as a Tau \.sim or \.tau\.json sheet/);
  });

  it("enumerates and parses a .asc child sheet through the real loader", async () => {
    // The child is a genuine `.asc`, produced by Tau's own exporter from the
    // buck document, so this exercises the same bytes a user would have on disk.
    const child = buckChildSheet();
    const ascText = schematicToAsc({
      components: child.components,
      wires: child.wires,
      netLabels: child.netLabels,
    }).text;

    const loaded = await loadProjectHierarchySheets({
      projectRoot: "/proj",
      rootSheetPath: "/proj/top.sim",
      tree,
      readText: async (path) => {
        if (path === "/proj/Buck25to5.asc") return ascText;
        throw new Error(`unexpected read of ${path}`);
      },
    });

    expect(loaded.rootPath).toBe("top.sim");
    const sheet = loaded.sheets.find((entry) => entry.path === "Buck25to5.asc");
    expect(sheet, "the .asc child was enumerated, not skipped").toBeDefined();
    // And it came back as the real circuit, with its ports intact - not an
    // empty document that would fail later for an unrelated reason.
    expect(sheet!.document.components.length).toBeGreaterThan(0);
    const ports = (sheet!.document.netLabels ?? []).filter((label) => label.port);
    expect(ports.map((p) => p.text).sort()).toEqual(["VIN", "VOUT"]);
  });
});

/**
 * The generated block, pinned exactly.
 *
 * A golden string is worth the maintenance here because every interesting
 * property of this feature is visible in it at once: the port order, the model
 * cards carried inside the body, the internal node namespace, and the fact that
 * the catch diode resolves to a real Shockley junction rather than the ideal one.
 * A silent change to any of those is the failure mode that a "does it contain an
 * S line" assertion would sail straight past.
 */
describe("the emitted block, byte for byte", () => {
  it("matches the validated reference deck", () => {
    const built = buildProjectHierarchyDeck({
      rootPath: "top.sim",
      root: topSheet() as never,
      sheets: [{ path: "Buck25to5.asc", document: buckChildSheet() as never }],
      analysis: { kind: "tran", stopTime: 5e-3, steps: 2000 } as never,
    });
    expect(built.blocks[0].text.split("\n")).toEqual([
      ".subckt Buck25to5 VIN VOUT",
      // Carried in the BODY, not left to the root: the root deck decides whether
      // to emit its starter cards from the root's own component kinds, and this
      // parent is only a source, a load and a block.
      ".model TAU_SW SW(Ron=1m Roff=1e9 Vt=0.5 Vh=0)",
      ".model TAU_DIODE D(Is=1e-14 N=1)",
      // VIN -> switch -> SW node (n2); gate is n1.
      "S__tau_Buck25to5_1 VIN __tau_buck25to5_n2 __tau_buck25to5_n1 0 TAU_SW",
      "L__tau_Buck25to5_2 __tau_buck25to5_n2 VOUT 0.0047",
      // Catch diode, ground -> SW node. One line, so the real junction: the
      // ideal path would emit a second zero-volt sense source here.
      "D__tau_Buck25to5_3 0 __tau_buck25to5_n2 TAU_DIODE",
      "V__tau_Buck25to5_4 __tau_buck25to5_n1 0 DC 0 PULSE(0 5 0 1e-9 1e-9 0.000001107 0.000005)",
      "C__tau_Buck25to5_5 VOUT 0 5e-7",
      "R__tau_Buck25to5_6 VOUT __tau_buck25to5_n3 100",
      "C__tau_Buck25to5_7 __tau_buck25to5_n3 0 0.000009999999999999999",
      ".ends Buck25to5",
    ]);
  });
});

/**
 * Every component kind has a recorded decision, and every refusal says
 * something useful.
 *
 * The original defect was not that the supported set was small - it was that it
 * could fall behind the palette in silence, so a part a user could place refused
 * only at Run with a message that named no way forward. The table is an
 * exhaustive `Record<ComponentKind, …>`, so a NEW kind is a `tsc` error rather
 * than a silent gap; this test covers the other half, that the decisions which
 * do exist are specific enough to act on.
 */
describe("every component kind has a stated disposition", () => {
  const ALL_KINDS: SchematicComponent["kind"][] = [
    "resistor", "capacitor", "polarizedCapacitor", "inductor", "vsource", "isource",
    "vac", "iac", "vpulse", "logicConstant", "diode", "led", "zener", "photodiode",
    "opamp", "comparator", "digitalGate", "dflop", "srflop", "tflop", "jkflop",
    "counter", "timer555", "adc", "dac", "sevenSeg", "sampleHold", "modulator",
    "vcvs", "vccs", "cccs", "ccvs", "bsource", "nmos", "pmos", "njf", "pjf",
    "npn", "pnp", "potentiometer", "bulb", "switch", "pushButton", "spdt",
    "relay", "motor", "transformer", "ctTransformer", "tline", "subckt", "ground",
  ];

  it("emits exactly the kinds a linked sheet claims to support", () => {
    const emitted = ALL_KINDS.filter((kind) => childDeviceDisposition(kind) === "emit").sort();
    expect(emitted).toEqual([
      "capacitor", "diode", "ground", "inductor", "polarizedCapacitor",
      "resistor", "subckt", "switch", "vsource",
    ]);
  });

  it("gives every refused kind a reason that names a way forward", () => {
    for (const kind of ALL_KINDS) {
      const disposition = childDeviceDisposition(kind);
      if (disposition === "emit") continue;
      // Long enough to be a sentence, and it must explain rather than restate.
      expect(disposition.length, `${kind} refusal is a real explanation`).toBeGreaterThan(40);
      expect(disposition, `${kind} refusal explains or redirects`).toMatch(
        /Use |are emitted|belongs to|does not generate|carries no|cannot resolve|cannot rewrite|does not own|not carried/,
      );
    }
  });
});
