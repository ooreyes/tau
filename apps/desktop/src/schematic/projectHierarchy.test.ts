import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildSubcircuitPinOverride } from "./subcircuitGeometry";
import {
  buildProjectHierarchyDeck,
  ProjectHierarchyError,
  type ProjectHierarchyBuildInput,
  type ProjectHierarchySheet,
} from "./projectHierarchy";
import { loadProjectHierarchySheets } from "./projectHierarchyRuntime";
import { canonicalProjectSheetPath, projectRelativeSheetPath } from "./projectSubcircuit";
import type { ProjectSheetPort, SchematicComponent } from "./types";
import type { SchematicDocument } from "../store/useSchematic";

const label = (id: string, x: number, y: number, text: string, port?: "In" | "Out" | "BiDir") => ({
  id, x, y, text, ...(port ? { port } : {}),
});

function linkedInstance(
  id: string,
  labelText: string,
  x: number,
  y: number,
  sheetPath: string,
  model: string,
  ports: string[],
): SchematicComponent {
  const base: SchematicComponent = {
    id,
    kind: "subckt",
    x,
    y,
    rotation: 0,
    value: model,
    label: labelText,
  };
  return {
    ...base,
    pinOverride: buildSubcircuitPinOverride(base, ports),
    projectSubcircuit: { sheetPath, model, ports },
  };
}

function simpleRoot(instance: SchematicComponent): SchematicDocument {
  const pins = instance.pinOverride!;
  const input = pins[0]!;
  const output = pins[1]!;
  return {
    components: [
      { id: "v1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "10", label: "V1" },
      instance,
      { id: "rload", kind: "resistor", x: 240, y: 0, rotation: 0, value: "10", label: "Rload" },
    ],
    wires: [],
    netLabels: [
      label("vin-source", 0, -32, "VIN"),
      label("gnd-source", 0, 32, "GND"),
      label("vin-x", input.x, input.y, "VIN"),
      label("vout-x", output.x, output.y, "VOUT"),
      label("vout-load", 208, 0, "VOUT"),
      label("gnd-load", 272, 0, "GND"),
    ],
    directives: [],
  };
}

const twoPortInterface = (): { projectPorts: ProjectSheetPort[]; netLabels: SchematicDocument["netLabels"] } => ({
  projectPorts: [
    { name: "VIN", labelId: "in", direction: "In" },
    { name: "VOUT", labelId: "out", direction: "Out" },
  ],
  netLabels: [label("in", 0, 0, "VIN", "In"), label("out", 128, 0, "VOUT", "Out")],
});

function rcSheet(path = "filters/rc.sim"): ProjectHierarchySheet {
  const iface = twoPortInterface();
  return {
    path,
    document: {
      components: [
        { id: "r1", kind: "resistor", x: 32, y: 0, rotation: 0, value: "1k", label: "R1" },
        { id: "c1", kind: "capacitor", x: 96, y: 0, rotation: 0, value: "1u", label: "C1" },
      ],
      wires: [],
      netLabels: iface.netLabels,
      projectPorts: iface.projectPorts,
      directives: [],
    },
  };
}

function buckSheet(): ProjectHierarchySheet {
  return {
    path: "power/buck-cell.sim",
    document: {
      components: [
        { id: "l1", kind: "inductor", x: 32, y: 0, rotation: 0, value: "1m", label: "L1" },
        { id: "c1", kind: "capacitor", x: 96, y: 0, rotation: 0, value: "1u", label: "C1" },
      ],
      wires: [],
      netLabels: [
        label("vin", 0, 0, "VIN", "In"),
        label("vout", 64, 0, "VOUT", "Out"),
        label("gnd", 128, 0, "GND", "BiDir"),
      ],
      projectPorts: [
        { name: "VIN", labelId: "vin", direction: "In" },
        { name: "VOUT", labelId: "vout", direction: "Out" },
        { name: "GND", labelId: "gnd", direction: "BiDir" },
      ],
      directives: [],
    },
  };
}

function hierarchyError(input: ProjectHierarchyBuildInput): ProjectHierarchyError {
  try {
    buildProjectHierarchyDeck(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectHierarchyError);
    return error as ProjectHierarchyError;
  }
  throw new Error("Expected hierarchy compiler to refuse the document.");
}

describe("Tau project-linked hierarchy compiler", () => {
  it("emits a real dependency block and a parent-to-child buck-style deck", () => {
    const instance = linkedInstance("x1", "X1", 100, 0, "power/buck-cell.sim", "TauBuck", ["VIN", "VOUT", "GND"]);
    const root = simpleRoot(instance);
    // The two-port root helper intentionally only connects p1/p2. A third
    // port is tied to the parent's existing GND label, exactly as a buck cell
    // would be connected in a project sheet.
    const gndPin = instance.pinOverride![2]!;
    root.netLabels!.push(label("gnd-x", gndPin.x, gndPin.y, "GND"));

    const result = buildProjectHierarchyDeck({
      rootPath: "top.sim",
      root,
      sheets: [buckSheet()],
      analysis: { kind: "op" },
    });

    expect(result.blocks).toEqual([expect.objectContaining({
      model: "TauBuck",
      sheetPath: "power/buck-cell.sim",
      text: [
        ".subckt TauBuck VIN VOUT GND",
        "L__tau_TauBuck_1 VIN VOUT 0.001",
        "C__tau_TauBuck_2 VOUT GND 0.000001",
        ".ends TauBuck",
      ].join("\n"),
    })]);
    expect(result.deck.unresolvedSubckts).toEqual([]);
    expect(result.deck.netlist).toContain(".subckt TauBuck VIN VOUT GND");
    expect(result.deck.netlist).toMatch(/X1\s+\S+\s+\S+\s+\S+\s+TauBuck/);
  });

  it("runs the two-sheet fixture through Tau's native ngspice fixture without losing port order", () => {
    const ngspice = process.env.TAU_NGSPICE_BIN ?? "/opt/homebrew/bin/ngspice";
    expect(existsSync(ngspice), `Tau native ngspice fixture is required at ${ngspice}; set TAU_NGSPICE_BIN for the staged binary.`).toBe(true);
    const instance = linkedInstance("x1", "X1", 100, 0, "power/buck-cell.sim", "TauBuck", ["VIN", "VOUT", "GND"]);
    const root = simpleRoot(instance);
    const gndPin = instance.pinOverride![2]!;
    root.netLabels!.push(label("gnd-x", gndPin.x, gndPin.y, "GND"));
    const { deck } = buildProjectHierarchyDeck({
      rootPath: "top.sim",
      root: { ...root, directives: [".print op v(VOUT) i(V1)"] },
      sheets: [buckSheet()],
      analysis: { kind: "op" },
    });
    const directory = mkdtempSync(join(tmpdir(), "tau-project-hierarchy-"));
    const deckPath = join(directory, "buck.cir");
    try {
      writeFileSync(deckPath, deck.netlist);
      const native = spawnSync(ngspice, ["-b", deckPath], { encoding: "utf8" });
      expect(native.status, `${native.stdout}\n${native.stderr}`).toBe(0);
      expect(`${native.stdout}\n${native.stderr}`).not.toMatch(/\berror\b/i);
      // The child is intentionally asymmetric: 1 kΩ from VIN to VOUT and a
      // 10 Ω root load. Both the voltage and source current prove that the
      // ordered VIN/VOUT/GND contract reached the native deck.
      const output = `${native.stdout}\n${native.stderr}`;
      expect(output).toMatch(/9\.999000e\+00/);
      expect(output).toMatch(/-9\.99900e-01/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("orders recursive blocks dependency-first independently of project tree order", () => {
    const leaf = rcSheet("cells/leaf.sim");
    const outerInstance = linkedInstance("inner", "Xinner", 64, 0, "cells/leaf.sim", "TauLeaf", ["VIN", "VOUT"]);
    const outer: ProjectHierarchySheet = {
      path: "cells/outer.sim",
      document: {
        components: [outerInstance], wires: [], directives: [],
        netLabels: [
          label("in", outerInstance.pinOverride![0]!.x, outerInstance.pinOverride![0]!.y, "VIN", "In"),
          label("out", outerInstance.pinOverride![1]!.x, outerInstance.pinOverride![1]!.y, "VOUT", "Out"),
        ],
        projectPorts: [
          { name: "VIN", labelId: "in", direction: "In" },
          { name: "VOUT", labelId: "out", direction: "Out" },
        ],
      },
    };
    const root = simpleRoot(linkedInstance("x1", "X1", 100, 0, "cells/outer.sim", "TauOuter", ["VIN", "VOUT"]));
    const forward = buildProjectHierarchyDeck({ rootPath: "top.sim", root, sheets: [outer, leaf], analysis: { kind: "op" } });
    const reversed = buildProjectHierarchyDeck({ rootPath: "top.sim", root, sheets: [leaf, outer], analysis: { kind: "op" } });
    expect(forward.blocks.map((block) => block.model)).toEqual(["TauLeaf", "TauOuter"]);
    expect(reversed.blocks).toEqual(forward.blocks);
    expect(reversed.deck.netlist).toBe(forward.deck.netlist);
  });

  it("refuses missing sheets, recursive cycles, duplicate ports, and duplicate project models", () => {
    const missing = hierarchyError({
      rootPath: "top.sim",
      root: simpleRoot(linkedInstance("x1", "X1", 100, 0, "missing.sim", "Missing", ["VIN", "VOUT"])),
      sheets: [], analysis: { kind: "op" },
    });
    expect(missing.code).toBe("missing-sheet");

    const aInstance = linkedInstance("xb", "XB", 64, 0, "b.sim", "BCell", ["VIN", "VOUT"]);
    const bInstance = linkedInstance("xa", "XA", 64, 0, "a.sim", "ACell", ["VIN", "VOUT"]);
    const interfaceFor = (instance: SchematicComponent): SchematicDocument => ({
      components: [instance], wires: [], directives: [],
      netLabels: [
        label("in", instance.pinOverride![0]!.x, instance.pinOverride![0]!.y, "VIN", "In"),
        label("out", instance.pinOverride![1]!.x, instance.pinOverride![1]!.y, "VOUT", "Out"),
      ],
      projectPorts: [
        { name: "VIN", labelId: "in", direction: "In" },
        { name: "VOUT", labelId: "out", direction: "Out" },
      ],
    });
    const cycle = hierarchyError({
      rootPath: "top.sim",
      root: simpleRoot(linkedInstance("x1", "X1", 100, 0, "a.sim", "ACell", ["VIN", "VOUT"])),
      sheets: [{ path: "a.sim", document: interfaceFor(aInstance) }, { path: "b.sim", document: interfaceFor(bInstance) }],
      analysis: { kind: "op" },
    });
    expect(cycle.code).toBe("cycle");
    expect(cycle.message).toContain("a.sim → b.sim → a.sim");

    const duplicatePort = rcSheet("bad.sim");
    duplicatePort.document.netLabels = [
      label("in", 0, 0, "VIN", "In"),
      label("out", 0, 0, "VOUT", "Out"),
    ];
    const duplicate = hierarchyError({
      rootPath: "top.sim",
      root: simpleRoot(linkedInstance("x1", "X1", 100, 0, "bad.sim", "Bad", ["VIN", "VOUT"])),
      sheets: [duplicatePort], analysis: { kind: "op" },
    });
    expect(duplicate.code).toBe("duplicate-port");

    const first = rcSheet("first.sim");
    const second = rcSheet("second.sim");
    const one = linkedInstance("x1", "X1", 100, 0, "first.sim", "SameModel", ["VIN", "VOUT"]);
    const two = linkedInstance("x2", "X2", 400, 0, "second.sim", "SameModel", ["VIN", "VOUT"]);
    const duplicateModel = hierarchyError({
      rootPath: "top.sim",
      root: { ...simpleRoot(one), components: [...simpleRoot(one).components, two] },
      sheets: [first, second], analysis: { kind: "op" },
    });
    expect(duplicateModel.code).toBe("duplicate-model");
  });

  it("leaves ordinary imported/file-backed subcircuits on the existing deck path", () => {
    const generic: SchematicComponent = {
      id: "x1", kind: "subckt", x: 100, y: 0, rotation: 0, value: "Legacy", label: "X1",
    };
    generic.pinOverride = buildSubcircuitPinOverride(generic, ["VIN", "VOUT"]);
    const root = {
      ...simpleRoot(generic),
      directives: [".subckt Legacy VIN VOUT\nRlegacy VIN VOUT 1k\n.ends Legacy"],
    };
    const result = buildProjectHierarchyDeck({ rootPath: "top.sim", root, sheets: [], analysis: { kind: "op" } });
    expect(result.blocks).toEqual([]);
    expect(result.deck.netlist).toContain(".subckt Legacy VIN VOUT");
    expect(result.deck.netlist).toMatch(/X1\s+\S+\s+\S+\s+Legacy/);
  });

  it("refuses a non-ideal child wire instead of silently dropping its resistance", () => {
    const sheet = rcSheet("wire.sim");
    sheet.document.wires = [{
      id: "rwire",
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      resistance: "1",
    }];
    const error = hierarchyError({
      rootPath: "top.sim",
      root: simpleRoot(linkedInstance("x1", "X1", 100, 0, "wire.sim", "WireCell", ["VIN", "VOUT"])),
      sheets: [sheet],
      analysis: { kind: "op" },
    });
    expect(error.code).toBe("unsupported-child");
    expect(error.message).toMatch(/wire resistance.*not emitted/i);
  });

  it("reserves case-folded public ports before allocating generated internal nodes", () => {
    const sheet = rcSheet("reserved.sim");
    sheet.document.netLabels = [
      label("in", 0, 0, "VIN", "In"),
      label("out", 128, 0, "__tau_CELL_n1", "Out"),
    ];
    sheet.document.projectPorts = [
      { name: "VIN", labelId: "in", direction: "In" },
      { name: "__tau_CELL_n1", labelId: "out", direction: "Out" },
    ];
    const result = buildProjectHierarchyDeck({
      rootPath: "top.sim",
      root: simpleRoot(linkedInstance("x1", "X1", 100, 0, "reserved.sim", "Cell", ["VIN", "__tau_CELL_n1"])),
      sheets: [sheet],
      analysis: { kind: "op" },
    });
    expect(result.blocks[0]?.text).toContain("__tau_cell_n2");
    expect(result.blocks[0]?.text).not.toContain("__tau_cell_n1 __tau_cell_n1");
  });

  it("preserves root params/functions/options and refuses generated collisions with ordinary X instances", () => {
    const linked = linkedInstance("x1", "X1", 100, 0, "filters/rc.sim", "TauFilter", ["VIN", "VOUT"]);
    const root = simpleRoot(linked);
    root.components.find((component) => component.label === "Rload")!.value = "{twice(5)}";
    const result = buildProjectHierarchyDeck({
      rootPath: "top.sim",
      root,
      sheets: [rcSheet()],
      analysis: { kind: "op" },
      rootDeck: {
        params: { scope: { gain: 2 }, funcs: { twice: { params: ["x"], body: "2*x" } } },
        directives: [".param gain=2", ".func twice(x) {2*x}", ".options reltol=1e-5", ".step param gain 1 2 1"],
      },
      deckOptions: { emitNativeStep: true },
    });
    expect(result.deck.netlist).toMatch(/\.options.*reltol=1e-5/);
    expect(result.deck.netlist).toContain(".step param gain 1 2 1");
    expect(result.deck.netlist).toMatch(/\.param\s+gain\s*=\s*2/i);
    expect(result.deck.netlist).toMatch(/Rload\s+\S+\s+\S+\s+10(?:\.0+)?/);

    const ordinary: SchematicComponent = {
      id: "legacy", kind: "subckt", x: 300, y: 0, rotation: 0, value: "TauFilter", label: "Xlegacy",
      pinOverride: buildSubcircuitPinOverride({
        x: 300, y: 0, rotation: 0,
      }, ["VIN", "VOUT"]),
    };
    const collision = hierarchyError({
      rootPath: "top.sim",
      root: { ...root, components: [...root.components, ordinary] },
      sheets: [rcSheet()],
      analysis: { kind: "op" },
    });
    expect(collision.code).toBe("duplicate-definition");
    expect(collision.message).toMatch(/ordinary root X instance/i);
  });

  it("rejects drive, scheme, and prefix-containment paths with deterministic ASCII folding", () => {
    expect(canonicalProjectSheetPath("C:\\project\\child.sim")).toBeNull();
    expect(canonicalProjectSheetPath("web://project/child.sim")).toBeNull();
    expect(projectRelativeSheetPath("/tmp/Project", "/tmp/Project-old/child.sim")).toBeNull();
    expect(projectRelativeSheetPath("/tmp/Project", "/tmp/project/Child.sim")).toBe("Child.sim");
    expect(canonicalProjectSheetPath("İ.sim")).toBe("İ.sim");
  });

  it("loads every in-root Tau candidate and refuses an out-of-root candidate", async () => {
    const child = rcSheet("child.sim").document;
    const tree = [
      { name: "top.sim", path: "/project/top.sim", kind: "file" as const },
      { name: "child.sim", path: "/project/child.sim", kind: "file" as const },
    ];
    const loaded = await loadProjectHierarchySheets({
      projectRoot: "/project",
      rootSheetPath: "/project/top.sim",
      tree,
      readText: async () => JSON.stringify(child),
    });
    expect(loaded.rootPath).toBe("top.sim");
    expect(loaded.sheets.map((sheet) => sheet.path)).toEqual(["child.sim"]);

    await expect(loadProjectHierarchySheets({
      projectRoot: "/project",
      rootSheetPath: "/project/top.sim",
      tree: [...tree, { name: "evil.sim", path: "/project-old/evil.sim", kind: "file" as const }],
      readText: async () => JSON.stringify(child),
    })).rejects.toMatchObject({ code: "invalid-path" });
  });
});
