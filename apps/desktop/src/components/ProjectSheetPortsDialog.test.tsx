// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSheetPortsDialog, ProjectSheetPortsEditor } from "./ProjectSheetPortsDialog";
import { useSchematic, type SchematicDocument } from "../store/useSchematic";
import { buildProjectHierarchyDeck } from "../schematic/projectHierarchy";
import { buildSubcircuitPinOverride } from "../schematic/subcircuitGeometry";
import type { SchematicComponent } from "../schematic/types";

describe("ProjectSheetPortsEditor", () => {
  beforeEach(() => {
    useSchematic.getState().newCircuit();
    useSchematic.setState({
      netLabels: [
        { id: "in-label", x: 0, y: 0, text: "IN", port: "In" },
        { id: "out-label", x: 64, y: 0, text: "OUT", port: "Out" },
      ],
      projectPorts: [],
    });
  });

  afterEach(() => cleanup());

  it("authors a child port name through its mapped label and keeps the edit undoable", () => {
    render(<ProjectSheetPortsEditor />);

    fireEvent.click(screen.getByRole("button", { name: "Mark IN as an input" }));
    expect(useSchematic.getState().projectPorts).toEqual([
      { name: "IN", labelId: "in-label", direction: "In" },
    ]);
    expect(screen.queryByRole("combobox", { name: "Port 1 label mapping" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Port 1 direction" })).toBeNull();
    expect(screen.getByRole("button", { name: "Set IN as an input" })).toBeTruthy();

    const name = screen.getByRole("textbox", { name: "Port 1 name" });
    fireEvent.change(name, { target: { value: "INPUT" } });
    fireEvent.blur(name);

    expect(useSchematic.getState().projectPorts).toEqual([
      { name: "INPUT", labelId: "in-label", direction: "In" },
    ]);
    expect(useSchematic.getState().netLabels[0]).toMatchObject({ text: "INPUT", port: "In" });
    // Add and rename are each one store transaction; undoing the rename cannot
    // expose an intermediate label/port mismatch.
    expect(useSchematic.getState().past).toHaveLength(2);
  });

  it("preserves explicit ordered mapping when ports are reordered", () => {
    render(<ProjectSheetPortsEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Mark IN as an input" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark OUT as an output" }));

    expect(useSchematic.getState().projectPorts.map((port) => port.name)).toEqual(["IN", "OUT"]);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Move port 2 up" })));

    expect(useSchematic.getState().projectPorts).toEqual([
      { name: "OUT", labelId: "out-label", direction: "Out" },
      { name: "IN", labelId: "in-label", direction: "In" },
    ]);
    expect(screen.getAllByRole("textbox", { name: /Port \d name/ })[0]).toHaveProperty("value", "OUT");
  });

  it("B1: no control invents a port - the footer button only arms the drawing tool", () => {
    const onRequestClose = vi.fn();
    render(<ProjectSheetPortsEditor onRequestClose={onRequestClose} />);

    // PDF5 reason 2: the old "Add project port" grabbed the first unused label.
    expect(screen.queryByRole("button", { name: /Add project port/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Pick a net on the drawing" }));
    expect(useSchematic.getState().projectPorts).toEqual([]);
    expect(useSchematic.getState().tool).toEqual({ mode: "label" });
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("B3: a marked candidate takes the direction chosen in the UI, never the label's own", () => {
    render(<ProjectSheetPortsEditor />);
    // "OUT" already carries port: "Out". Choosing input must win.
    fireEvent.click(screen.getByRole("button", { name: "Mark OUT as an input" }));

    expect(useSchematic.getState().projectPorts).toEqual([
      { name: "OUT", labelId: "out-label", direction: "In" },
    ]);
    expect(useSchematic.getState().netLabels[1]).toMatchObject({ text: "OUT", port: "In" });

    // A net that is already a port is shown as such, and offers no second add.
    expect(screen.getByText("Port 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Mark OUT as/ })).toBeNull();
  });

  it("uses one selectable net row as the source of truth for exposure and direction", () => {
    render(<ProjectSheetPortsEditor />);

    const inRow = screen.getByRole("button", { name: "Select IN" });
    fireEvent.click(inRow);
    expect(inRow.getAttribute("aria-selected")).toBeNull();
    expect(inRow.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Selected IN; choose a direction" })).toBeTruthy();
    // Choosing the electrical role is the only gesture that authors a port.
    fireEvent.click(screen.getByRole("button", { name: "Mark IN as an output" }));
    expect(useSchematic.getState().projectPorts).toEqual([
      { name: "IN", labelId: "in-label", direction: "Out" },
    ]);
    expect(screen.getByRole("button", { name: "Deselect IN" }).getAttribute("aria-pressed")).toBe("true");
    const both = document.querySelector<HTMLButtonElement>('button[aria-label="Set IN as bidirectional"]');
    expect(both?.getAttribute("aria-pressed")).toBe("false");
    // The same row offers the direction update; no second candidate/form row exists.
    expect(document.querySelectorAll(".project-sheet-net-list > li")).toHaveLength(2);
    fireEvent.click(both!);
    expect(useSchematic.getState().projectPorts[0]?.direction).toBe("BiDir");
    fireEvent.click(screen.getByRole("button", { name: "Deselect IN" }));
    expect(useSchematic.getState().projectPorts).toEqual([]);
  });

  it("keeps keyboard focus semantics on a selected net and exposes order controls", () => {
    render(<ProjectSheetPortsEditor />);
    const row = screen.getByRole("button", { name: "Select OUT" });
    row.focus();
    expect(document.activeElement).toBe(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(row.getAttribute("aria-selected")).toBeNull();
    expect(row.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Mark OUT as an output" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark IN as an input" }));
    expect(screen.getByRole("button", { name: "Move port 1 up" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Move port 1 down" }).hasAttribute("disabled")).toBe(false);
  });

  it("says in plain words that nothing is marked yet", () => {
    render(<ProjectSheetPortsEditor />);
    expect(screen.getByRole("status").textContent).toBe(
      "This sheet has no inputs or outputs marked yet. Mark a net and this sheet can be used as a block on another sheet.",
    );
  });

  it("refuses interface authoring up front on a sheet that cannot carry one", () => {
    const reason = "An .asc sheet cannot carry a Tau sheet interface - save it as .sim first";
    render(<ProjectSheetPortsEditor interfaceDisabledReason={reason} />);

    expect(screen.getByRole("note").textContent).toContain(reason);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("combobox")).toEqual([]);
  });

  it("shows who instantiates this sheet when the host supplies it", () => {
    render(<ProjectSheetPortsEditor usedBy={[
      { sheetPath: "z-top.sim", reference: "X2" },
      { sheetPath: "a-top.sim", reference: "X9" },
      { sheetPath: "a-top.sim", reference: "X1" },
    ]} />);
    const usedBy = screen.getByRole("group", { name: "Parent mapping" });
    expect(usedBy.textContent).toContain("a-top.sim");
    expect(usedBy.textContent).toContain("X1");
    expect([...usedBy.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
      "a-top.sim→X1",
      "a-top.sim→X9",
      "z-top.sim→X2",
    ]);
  });

  it("makes the contract and unresolved parent index visible without inventing a role", () => {
    render(<ProjectSheetPortsEditor />);
    expect(screen.getByText("Public contract")).toBeTruthy();
    expect(document.querySelector(".project-sheet-contract-summary")?.textContent).toContain("Unconfigured");
    expect(screen.getByRole("group", { name: "Parent mapping" }).textContent).toContain("not fully indexed");
  });

  it("offers a durable replay action without changing the stored port contract", () => {
    const onReplay = vi.fn();
    render(<ProjectSheetPortsEditor onReplayGuidance={onReplay} />);
    fireEvent.click(screen.getByRole("button", { name: "Replay sheet interface guide" }));
    expect(onReplay).toHaveBeenCalledOnce();
    expect(useSchematic.getState().projectPorts).toEqual([]);
  });
});

/**
 * The student trap PDF5 never closed: the two authoring mistakes the fail-closed
 * compiler catches - a marked net that touches no component pin, and two ports
 * sharing one electrical net - were only ever reported by Run, on a DIFFERENT
 * sheet, after the parent had already been wired. This block asserts the child's
 * own editor says the same thing at the moment of the gesture, and that its
 * "ready" claim agrees with the compiler rather than merely sounding confident.
 *
 * The expected wording is DERIVED: every phrase below is pulled out of the
 * message `buildProjectHierarchyDeck` actually throws for the same document.
 */
describe("child-side agreement with the compiler (student path)", () => {
  const label = (id: string, x: number, y: number, text: string, port?: "In" | "Out" | "BiDir") => ({
    id, x, y, text, ...(port ? { port } : {}),
  });

  // R1 spans (0,0)-(64,0); C1 spans (64,0)-(128,0). DANGLE sits on nothing.
  const childComponents: SchematicComponent[] = [
    { id: "r1", kind: "resistor", x: 32, y: 0, rotation: 0, value: "1k", label: "R1" },
    { id: "c1", kind: "capacitor", x: 96, y: 0, rotation: 0, value: "100n", label: "C1" },
  ];
  const childLabels = [
    label("in", 0, 0, "VIN", "In"),
    label("out", 128, 0, "VOUT", "Out"),
    label("twin", 0, 0, "ALSOIN", "In"),
    label("loose", 400, 400, "DANGLE", "In"),
  ];

  afterEach(() => cleanup());

  const mountChild = () => {
    useSchematic.getState().newCircuit();
    useSchematic.setState({ components: childComponents, wires: [], netLabels: childLabels, projectPorts: [] });
  };

  /** What Run says about this exact child, in Run's own words. */
  function compilerVerdict(portNames: readonly string[]): string | null {
    const state = useSchematic.getState();
    const child: SchematicDocument = {
      components: state.components,
      wires: state.wires,
      netLabels: state.netLabels,
      projectPorts: state.projectPorts,
      directives: [],
    };
    const base: SchematicComponent = {
      id: "x1", kind: "subckt", x: 300, y: 0, rotation: 0, value: "Child", label: "X1",
    };
    const instance: SchematicComponent = {
      ...base,
      pinOverride: buildSubcircuitPinOverride(base, [...portNames]),
      projectSubcircuit: { sheetPath: "child.sim", model: "Child", ports: [...portNames] },
    };
    const root: SchematicDocument = {
      components: [
        { id: "v1", kind: "vsource", x: 0, y: 0, rotation: 0, value: "1", label: "V1" },
        instance,
      ],
      wires: [],
      netLabels: [
        label("rv", 0, -32, "NA"), label("rg", 0, 32, "GND"),
        ...instance.pinOverride!.map((pin, index) => label(`rp${index}`, pin.x, pin.y, index === 0 ? "NA" : `NODE${index}`)),
      ],
      directives: [],
    };
    try {
      buildProjectHierarchyDeck({
        rootPath: "top.sim", root, sheets: [{ path: "child.sim", document: child }], analysis: { kind: "op" },
      });
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }

  it("names an unconnected marked net in the compiler's own words, before Run", () => {
    mountChild();
    render(<ProjectSheetPortsEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Mark VIN as an input" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark DANGLE as an input" }));

    const refusal = compilerVerdict(["VIN", "DANGLE"]);
    expect(refusal).toContain("DANGLE");
    // e.g. 'Port "DANGLE" on "child.sim" does not connect to a component net.'
    const phrase = /on "[^"]+" (.+)\.$/.exec(refusal!)?.[1];
    expect(phrase).toBeTruthy();

    const problems = screen.getByRole("alert");
    expect(problems.textContent).toContain("DANGLE");
    expect(problems.textContent).toContain(phrase!);
    // The port that IS on a component net must not be smeared with the blame.
    expect(problems.textContent).not.toContain("VIN ");
  });

  it("names two ports that share one net, in the compiler's own words", () => {
    mountChild();
    render(<ProjectSheetPortsEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Mark VIN as an input" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark ALSOIN as an input" }));

    const refusal = compilerVerdict(["VIN", "ALSOIN"]);
    const phrase = /Ports on "[^"]+" (.+) \(/.exec(refusal!)?.[1];
    expect(phrase, refusal ?? "compiler accepted a shared-net interface").toBeTruthy();

    const problems = screen.getByRole("alert");
    expect(problems.textContent).toContain(phrase!);
    expect(problems.textContent).toContain("ALSOIN");
  });

  it("only claims the sheet is ready when the compiler would accept it, and shows the pinout order", () => {
    mountChild();
    render(<ProjectSheetPortsEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Mark VIN as an input" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark VOUT as an output" }));

    expect(compilerVerdict(["VIN", "VOUT"])).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    const ready = screen.getByRole("status");
    expect(ready.textContent).toContain("VIN, VOUT");

    // Marking the dangling net revokes the claim in the same breath.
    fireEvent.click(screen.getByRole("button", { name: "Mark DANGLE as an input" }));
    expect(compilerVerdict(["VIN", "VOUT", "DANGLE"])).not.toBeNull();
    expect(screen.queryByRole("status")?.textContent ?? "").not.toContain("VIN, VOUT, DANGLE");
    expect(screen.getByRole("alert").textContent).toContain("DANGLE");
  });
});

describe("ProjectSheetPortsDialog geometry and undo", () => {
  afterEach(() => cleanup());

  it("keeps a long interface reachable: the body scrolls, Done and the drawing button do not leave the window", () => {
    useSchematic.getState().newCircuit();
    // 14 named nets and 6 marked ports is an ordinary medium block, and it is
    // more rows than a 600px-tall window can show.
    useSchematic.setState({
      netLabels: Array.from({ length: 14 }, (_, index) => ({
        id: `n${index}`, x: index * 32, y: 0, text: `NET${index}`, ...(index < 6 ? { port: "In" as const } : {}),
      })),
      projectPorts: Array.from({ length: 6 }, (_, index) => ({
        name: `NET${index}`, labelId: `n${index}`, direction: "In" as const,
      })),
    });
    render(<ProjectSheetPortsDialog open onOpenChange={() => {}} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(14);
    const scroll = document.querySelector("[data-slot='sheet-interface-scroll']");
    expect(scroll, "the interface body must live in a bounded, scrollable region").toBeTruthy();
    expect(scroll!.className).toContain("overflow-y-auto");
    expect(scroll!.className).toMatch(/max-h-/);
    // The two ways out must be siblings of that region, never inside it.
    for (const name of ["Done", "Pick a net on the drawing"]) {
      const button = screen.getByRole("button", { name });
      expect(scroll!.contains(button), `${name} must stay outside the scrolling body`).toBe(
        name === "Pick a net on the drawing",
      );
    }
  });

  it("shows the store's truth after undo, not a stale draft", () => {
    useSchematic.getState().newCircuit();
    useSchematic.setState({
      netLabels: [{ id: "in-label", x: 0, y: 0, text: "IN", port: "In" as const }],
      projectPorts: [],
    });
    render(<ProjectSheetPortsEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Mark IN as an input" }));
    expect(screen.getAllByRole("textbox", { name: /Port \d name/ })).toHaveLength(1);

    act(() => useSchematic.getState().undo());
    expect(useSchematic.getState().projectPorts).toEqual([]);
    expect(screen.queryAllByRole("textbox", { name: /Port \d name/ })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Mark IN as an input" })).toBeTruthy();

    act(() => useSchematic.getState().redo());
    expect(useSchematic.getState().projectPorts).toEqual([
      { name: "IN", labelId: "in-label", direction: "In" },
    ]);
    expect(screen.getAllByRole("textbox", { name: /Port \d name/ })).toHaveLength(1);
  });
});
