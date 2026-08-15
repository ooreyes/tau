import { describe, expect, it } from "vitest";
import {
  hierarchyBlockViews,
  hierarchySheetUsedBy,
  hierarchySheetUsers,
  sheetDeclaredPorts,
  type HierarchySheetDocument,
} from "./hierarchyGraph";
import { buildSubcircuitPinOverride } from "./subcircuitGeometry";
import type { ProjectHierarchySheet } from "./projectHierarchy";
import type { SchematicComponent } from "./types";

const CHILD = "buck.sim";
const PORTS = ["VIN", "VOUT"];

/** A block instance whose bank matches its contract, the ordinary case. */
function block(overrides: Partial<SchematicComponent> = {}): SchematicComponent {
  const base: SchematicComponent = {
    id: "x1", kind: "subckt", x: 96, y: 192, rotation: 0,
    value: "TauBuck", label: "X1",
    projectSubcircuit: { sheetPath: CHILD, model: "TauBuck", ports: PORTS },
  };
  return {
    ...base,
    pinOverride: buildSubcircuitPinOverride(base, PORTS, ["In", "Out"]),
    ...overrides,
  };
}

/** The child sheet, declaring its interface explicitly. */
function childSheet(): ProjectHierarchySheet {
  return {
    path: CHILD,
    document: {
      components: [{ id: "r1", kind: "resistor", x: 0, y: 0, rotation: 0, value: "1k", label: "R1" }],
      wires: [],
      netLabels: [
        { id: "l1", x: 0, y: -32, text: "VIN", port: "In" },
        { id: "l2", x: 0, y: 32, text: "VOUT", port: "Out" },
      ],
      projectPorts: [
        { name: "VIN", labelId: "l1", direction: "In" },
        { name: "VOUT", labelId: "l2", direction: "Out" },
      ],
    },
  } as ProjectHierarchySheet;
}

/** A parent holding one block, plus whatever else the case needs. */
function parent(extra: Partial<HierarchySheetDocument> = {}, instance = block()): HierarchySheetDocument {
  return { components: [instance], wires: [], netLabels: [], ...extra };
}

describe("sheetDeclaredPorts", () => {
  it("prefers the explicit ordered array over the port-marked labels", () => {
    const document = childSheet().document as HierarchySheetDocument;
    expect(sheetDeclaredPorts(document).map((port) => port.name)).toEqual(["VIN", "VOUT"]);
  });

  it("derives ports from the labels when a sheet has no explicit array", () => {
    // The .asc case: LTspice's format has nowhere to keep the ordered array, so
    // the interface has to be readable from FLAG/IOPIN alone.
    const document = childSheet().document as HierarchySheetDocument;
    const derived = sheetDeclaredPorts({ ...document, projectPorts: [] });
    expect(derived).toEqual([
      { name: "VIN", labelId: "l1", direction: "In" },
      { name: "VOUT", labelId: "l2", direction: "Out" },
    ]);
  });

  it("reports a duplicate rather than hiding it, because Run is about to refuse it", () => {
    const document = childSheet().document as HierarchySheetDocument;
    const doubled = sheetDeclaredPorts({
      ...document,
      projectPorts: [
        { name: "VIN", labelId: "l1", direction: "In" },
        { name: "VIN", labelId: "l2", direction: "Out" },
      ],
    });
    expect(doubled).toHaveLength(2);
  });
});

describe("hierarchyBlockViews", () => {
  it("names every terminal in contract order, with the child's declared direction", () => {
    const [view] = hierarchyBlockViews(parent(), [childSheet()]);
    expect(view.reference).toBe("X1");
    expect(view.model).toBe("TauBuck");
    expect(view.sheetPath).toBe(CHILD);
    expect(view.ports.map((port) => [port.position, port.name, port.direction])).toEqual([
      [1, "VIN", "In"],
      [2, "VOUT", "Out"],
    ]);
  });

  it("matches a direction by folded name, never by index", () => {
    // The child declares its ports in the opposite order to the parent's bank.
    // Order lives on the parent's bank, so a positional lookup would swap the
    // two directions and every side would flip with them.
    const child = childSheet();
    const reversed = {
      ...child,
      document: {
        ...child.document,
        projectPorts: [
          { name: "vout", labelId: "l2", direction: "Out" as const },
          { name: "vin", labelId: "l1", direction: "In" as const },
        ],
      },
    } as ProjectHierarchySheet;
    const [view] = hierarchyBlockViews(parent(), [reversed]);
    expect(view.ports.map((port) => [port.name, port.direction])).toEqual([
      ["VIN", "In"],
      ["VOUT", "Out"],
    ]);
  });

  it("reads a bound net from a label on the terminal, which is how pairing works", () => {
    const instance = block();
    const vin = instance.pinOverride!.find((pin) => pin.id === "p1")!;
    const [view] = hierarchyBlockViews(
      parent({ netLabels: [{ id: "n1", x: vin.x, y: vin.y, text: "PWR_5V" }] }, instance),
      [childSheet()],
    );
    expect(view.ports[0].boundNet).toBe("PWR_5V");
    expect(view.ports[1].boundNet).toBeNull();
  });

  it("calls a terminal with nothing on it unbound, not the net extraction minted for it", () => {
    // The sharp case. `extractCircuit` mints a net for every pin including a
    // dangling one, so a floating terminal comes back as a real-looking `N00x`.
    // Printing that under a heading like "connected to" would be a false
    // positive about the user's own circuit.
    const [view] = hierarchyBlockViews(parent(), [childSheet()]);
    expect(view.ports.map((port) => port.boundNet)).toEqual([null, null]);
  });

  it("reports a terminal the bank is missing as unbound and unplaced, borrowing nothing", () => {
    // The documented false-positive class: a `pinOverride` shorter than the
    // contract. Re-aligning by array slot would make row 2 claim row 1's net.
    const short = block({ pinOverride: buildSubcircuitPinOverride(block(), PORTS, ["In", "Out"]).slice(0, 1) });
    const vin = short.pinOverride![0];
    const [view] = hierarchyBlockViews(
      parent({ netLabels: [{ id: "n1", x: vin.x, y: vin.y, text: "PWR_5V" }] }, short),
      [childSheet()],
    );
    expect(view.ports).toHaveLength(2);
    expect(view.ports[0]).toMatchObject({ position: 1, name: "VIN", boundNet: "PWR_5V" });
    expect(view.ports[1]).toMatchObject({ position: 2, name: "VOUT", boundNet: null, side: null });
  });

  it("never lets a row borrow the net of a terminal with a different ordinal", () => {
    // The discriminating case for keyed-not-indexed lookup, and the reason the
    // short-bank test above is not enough on its own: with a GAPPED bank, only
    // p2 is present. Read by ordinal, row 1 is unbound and row 2 owns the net.
    // Read by array slot, row 1 would take slot 0 - which is p2 - and report
    // VOUT's net under VIN's name. That is a wrong answer about the user's
    // circuit, not merely a missing one.
    const full = buildSubcircuitPinOverride(block(), PORTS, ["In", "Out"]);
    const vout = full.find((pin) => pin.id === "p2")!;
    const gapped = block({ pinOverride: [vout] });
    const [view] = hierarchyBlockViews(
      parent({ netLabels: [{ id: "n1", x: vout.x, y: vout.y, text: "PWR_OUT" }] }, gapped),
      [childSheet()],
    );
    expect(view.ports[0]).toMatchObject({ position: 1, name: "VIN", boundNet: null, side: null });
    expect(view.ports[1]).toMatchObject({ position: 2, name: "VOUT", boundNet: "PWR_OUT" });
  });

  it("runs rows to the contract, not to a bank that is longer than it", () => {
    // A bank entry the X card never mentions must not become a row, or the
    // table describes a circuit that is not the one that would be run.
    const long = block({
      pinOverride: [
        ...buildSubcircuitPinOverride(block(), PORTS, ["In", "Out"]),
        { id: "p3", label: "STRAY", x: 999, y: 999 },
      ],
    });
    const [view] = hierarchyBlockViews(parent({}, long), [childSheet()]);
    expect(view.ports.map((port) => port.name)).toEqual(PORTS);
  });

  it("says nothing about a direction for a child sheet it was not given", () => {
    // Absence is never agreement. With no sheets passed, no direction was
    // checked, and the rows must not imply one was.
    const [view] = hierarchyBlockViews(parent());
    expect(view.ports.map((port) => port.direction)).toEqual(["BiDir", "BiDir"]);
  });

  it("shows a block whose kind the compiler would refuse, rather than filtering it", () => {
    // A review surface that hides the broken case is worse than no surface.
    const wrongKind = block({ kind: "resistor" });
    expect(hierarchyBlockViews(parent({}, wrongKind), [childSheet()])).toHaveLength(1);
  });

  it("falls back to the id when an instance carries no ref-des, never a blank heading", () => {
    const unlabelled = block({ label: "  " });
    const [view] = hierarchyBlockViews(parent({}, unlabelled), [childSheet()]);
    expect(view.reference).toBe("x1");
  });

  it("returns nothing for a sheet that instantiates nothing", () => {
    expect(hierarchyBlockViews({ components: [], wires: [], netLabels: [] })).toEqual([]);
  });
});

describe("the used-by relation", () => {
  const top = (id: string, path: string): ProjectHierarchySheet => ({
    path,
    document: { components: [block({ id })], wires: [], netLabels: [] },
  }) as ProjectHierarchySheet;

  it("collects every instantiation of a child, across sheets, in first-mention order", () => {
    const users = hierarchySheetUsers([top("x1", "top.sim"), top("x2", "other.sim")]);
    expect(users).toHaveLength(1);
    expect(users[0].usedBy.map((use) => [use.ownerPath, use.componentId])).toEqual([
      ["top.sim", "x1"],
      ["other.sim", "x2"],
    ]);
  });

  it("treats two spellings of one path as one sheet, folding the way the resolver does", () => {
    const shouty: ProjectHierarchySheet = {
      path: "other.sim",
      document: {
        components: [block({ id: "x2", projectSubcircuit: { sheetPath: "BUCK.SIM", model: "TauBuck", ports: PORTS } })],
        wires: [],
        netLabels: [],
      },
    } as ProjectHierarchySheet;
    expect(hierarchySheetUsers([top("x1", "top.sim"), shouty])).toHaveLength(1);
  });

  it("keeps a row for a child the project does not contain", () => {
    // Dropping it would make the surface silently agree that nothing points
    // there, when in fact something points at a sheet that is missing.
    expect(hierarchySheetUsedBy([top("x1", "top.sim")], CHILD)).toHaveLength(1);
  });

  it("answers with nothing for a sheet nobody instantiates", () => {
    expect(hierarchySheetUsedBy([top("x1", "top.sim")], "unused.sim")).toEqual([]);
  });
});
