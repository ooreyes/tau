// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { BottomPanel, ComponentInspector, ComponentsRail, EditorToolbar } from "./ShellPanels";
import type { AnalysisResult } from "../simulation/linearTransient";
import { useSchematic } from "../store/useSchematic";
import { usePanelWidth } from "./panelResize";

/**
 * The simulator view is read-only outside the schematic tab (pan/zoom/probe
 * only - see Canvas's `interactive` prop and App.tsx's keydown gate). This
 * toolbar renders unconditionally regardless of `mode` (App.tsx only swaps
 * the Canvas/Palette/ExplorerPanel), so its own editing controls need their
 * own `mode` gate - this was a second, mouse-driven bypass of the same bug
 * the keyboard gate fixes .
 */

beforeAll(() => {
  // Radix Select (ui/Select) needs pointer-capture APIs jsdom omits.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => cleanup());

function resetStore() {
  useSchematic.setState({
    components: [],
    wires: [],
    counters: {},
    selectedId: null,
    selectedWireId: null,
    selectedWireIds: [],
    selectedIds: [],
    selectedLabelIds: [],
    selectedProbeIds: [],
    tool: { mode: "select" },
    placeRotation: 0,
    placeMirror: false,
    clipboard: null,
    probes: [],
    netLabels: [],
    directives: [],
    userModelLibraries: [],
    past: [],
    future: [],
  });
}

beforeEach(() => resetStore());

const noopToolbarProps = {
  isRunning: false,
  onRun: () => {},
  onStop: () => {},
  onClearScratchpad: () => {},
  modelLibraryCount: 0,
  onOpenModelLibraries: () => {},
  onOpenSimulationSetup: () => {},
};

describe("EditorToolbar - read-only outside schematic view ", () => {
  it("keeps transport explicit: Run and Stop only, with no opaque refine button", () => {
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);
    expect(screen.getByRole("button", { name: "Run simulation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop simulation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refine transient resolution" })).toBeNull();
  });

  it("disables Wire, Net label, Undo, Redo, selection deletion, and Clear schematic in simulator mode", () => {
    const emptyDoc = { components: [], wires: [], counters: {}, probes: [], netLabels: [], directives: [], textAnnotations: [], ascShapes: [], ascDataFlags: [], ascForeignSymbols: [], ascHierarchicalBlocks: [], ascSheet: null, userModelLibraries: [] };
    // Both past and future populated so canUndo/canRedo would be true if the
    // mode gate weren't there - proves the gate, not just an empty history.
    useSchematic.setState({ past: [emptyDoc], future: [emptyDoc] });
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);

    for (const name of ["Wire", "Net label (F4)", "Undo", "Redo", "Delete selection (Delete)", "Clear schematic"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("does not undo the document when the disabled Undo button is clicked in simulator mode", () => {
    useSchematic.setState({
      components: [{ id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
      past: [{ components: [], wires: [], counters: {}, probes: [], netLabels: [], directives: [], textAnnotations: [], ascShapes: [], ascDataFlags: [], ascForeignSymbols: [], ascHierarchicalBlocks: [], ascSheet: null, userModelLibraries: [] }],
    });
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(useSchematic.getState().components).toHaveLength(1); // untouched
    expect(useSchematic.getState().past).toHaveLength(1); // history untouched
  });

  it("does not arm the wire tool when the disabled Wire button is clicked in simulator mode", () => {
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Wire" }));
    expect(useSchematic.getState().tool).toEqual({ mode: "select" });
  });

  it("does not open the clear-schematic confirmation when clicked in simulator mode", () => {
    const onClearScratchpad = vi.fn();
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} onClearScratchpad={onClearScratchpad} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear schematic" }));
    expect(onClearScratchpad).not.toHaveBeenCalled();
  });

  it("keeps Select and Probe enabled in simulator mode (probing must still work)", () => {
    render(<EditorToolbar mode="simulator" {...noopToolbarProps} />);
    expect((screen.getByRole("button", { name: "Select" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Probe" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens Simulation setup directly from the schematic toolbar", () => {
    const onOpenSimulationSetup = vi.fn();
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} onOpenSimulationSetup={onOpenSimulationSetup} />);
    fireEvent.click(screen.getByRole("button", { name: "Simulation setup" }));
    expect(onOpenSimulationSetup).toHaveBeenCalledOnce();
  });

  it("enables Wire, Undo (with history), and Clear schematic in schematic mode", () => {
    useSchematic.setState({ past: [{ components: [], wires: [], counters: {}, probes: [], netLabels: [], directives: [], textAnnotations: [], ascShapes: [], ascDataFlags: [], ascForeignSymbols: [], ascHierarchicalBlocks: [], ascSheet: null, userModelLibraries: [] }] });
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);

    for (const name of ["Wire", "Net label (F4)", "Undo", "Clear schematic"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("offers a direct toolbar action for the selected object", () => {
    useSchematic.setState({
      components: [{ id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
      selectedId: "r-1",
      selectedIds: ["r-1"],
    });
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);

    const remove = screen.getByRole("button", { name: "Delete selection (Delete)" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    fireEvent.click(remove);
    expect(useSchematic.getState().components).toEqual([]);
  });

  it("keeps the selection action disabled when there is nothing to remove", () => {
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} />);
    expect((screen.getByRole("button", { name: "Delete selection (Delete)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders a Model libraries button and calls the callback on click", () => {
    const onOpenModelLibraries = vi.fn();
    render(<EditorToolbar mode="schematic" {...noopToolbarProps} onOpenModelLibraries={onOpenModelLibraries} />);
    const button = screen.getByRole("button", { name: "Model libraries" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onOpenModelLibraries).toHaveBeenCalledTimes(1);
  });

  it("shows a count indicator only when libraries are attached", () => {
    const { rerender } = render(<EditorToolbar mode="schematic" {...noopToolbarProps} modelLibraryCount={0} />);
    expect(screen.queryByText("3")).toBeNull();
    rerender(<EditorToolbar mode="schematic" {...noopToolbarProps} modelLibraryCount={3} />);
    expect(screen.getByText("3")).toBeTruthy();
  });
});

describe("ComponentInspector - no-selection empty state", () => {
  it("shows the No Selection title and full helper text when nothing is selected", () => {
    render(<ComponentInspector selected={null} />);
    expect(screen.getByText("No Selection")).toBeTruthy();
    expect(
      screen.getByText(
        "Select a component, wire, node, or label to view and edit its properties.",
      ),
    ).toBeTruthy();
  });

  it("renders no input fields or dead controls when nothing is selected", () => {
    const { container } = render(<ComponentInspector selected={null} />);
    expect(container.querySelectorAll("input, select, button").length).toBe(0);
    expect(container.querySelector(".property-grid")).toBeNull();
    expect(container.querySelector(".inspector-summary.empty")).toBeTruthy();
  });
});

describe("ComponentInspector - imported op-amp parameters", () => {
  it("labels a non-library LTspice model honestly and exposes its joined parameter line", () => {
    const selected = {
      id: "u-1",
      kind: "opamp" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "Avol=1Meg GBW=10Gig Slew=10Gig ilimit=2 rail=0",
      label: "U1",
      ltExtraAttrs: {
        baseValue: "",
        derivedValue: "Avol=1Meg GBW=10Gig Slew=10Gig ilimit=2 rail=0",
        extras: {
          Value2: "Avol=1Meg GBW=10Gig Slew=10Gig",
          SpiceLine: "ilimit=2 rail=0",
        },
      },
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    const model = screen.getByRole("combobox", { name: "Op-amp model" });
    expect(model.tagName).toBe("BUTTON");
    expect(model.getAttribute("data-slot")).toBe("select-trigger");
    expect(model.textContent).toContain("Universal / behavioral");
    expect(document.querySelector(".property-field select[aria-label='Op-amp model']")).toBeNull();
    const parameters = screen.getByRole("textbox", { name: "Advanced op-amp parameters" }) as HTMLInputElement;
    expect(parameters.value).toBe(selected.value);

    fireEvent.change(parameters, {
      target: { value: "Avol=2Meg GBW=10Gig Slew=10Gig ilimit=2 rail=0" },
    });
    expect(useSchematic.getState().components[0].value)
      .toBe("Avol=2Meg GBW=10Gig Slew=10Gig ilimit=2 rail=0");
  });

  it("shows separate part/model controls and an honest missing-model action", () => {
    const selected = {
      id: "u-vendor",
      kind: "opamp" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "OP07 LT1001",
      label: "U1",
      ltSymbolType: "Opamps\\OP07",
      ltExtraAttrs: {
        baseValue: "OP07",
        derivedValue: "OP07 LT1001",
        extras: { Value2: "LT1001" },
      },
    };
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} onOpenModelLibraries={openLibraries} />);

    expect((screen.getByRole("textbox", { name: "Op-amp part" }) as HTMLInputElement).value).toBe("OP07");
    const model = screen.getByRole("textbox", { name: "Op-amp simulation model" }) as HTMLInputElement;
    expect(model.value).toBe("LT1001");
    expect(screen.getByRole("status").textContent).toMatch(/Needs a library model · Tau will not substitute a generic gain block/);
    fireEvent.click(screen.getByRole("button", { name: "Attach Model Library" }));
    expect(openLibraries).toHaveBeenCalledOnce();

    fireEvent.change(model, { target: { value: "MY_OP07" } });
    expect(useSchematic.getState().components[0]).toMatchObject({
      value: "OP07 MY_OP07",
      ltExtraAttrs: { extras: { Value2: "MY_OP07" } },
    });
  });
});

describe("ComponentInspector - semiconductor model chooser", () => {
  it("selects the exact bundled Class-D PMOS and drops inapplicable Level-1 geometry", () => {
    const selected = {
      id: "m-p",
      kind: "pmos" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "PMOS W=40u L=2u",
      label: "M1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    const chooser = screen.getByRole("combobox", { name: "Simulation model" }) as HTMLSelectElement;
    expect(Array.from(chooser.options).some((option) => option.textContent?.includes("RSR015P06 · Tau exact models"))).toBe(true);
    expect(Array.from(chooser.options).some((option) => option.textContent?.startsWith("QS6K1"))).toBe(false);
    fireEvent.change(chooser, { target: { value: "RSR015P06" } });

    expect(useSchematic.getState().components[0].value).toBe("RSR015P06");
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
  });

  it("offers compatible attached models with their filename and never wrong device types", () => {
    const selected = {
      id: "q-n",
      kind: "npn" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "MY_NPN",
      label: "Q1",
    };
    useSchematic.setState({
      components: [selected],
      selectedId: selected.id,
      selectedIds: [selected.id],
      userModelLibraries: [{
        name: "transistors.lib",
        text: ".model MY_NPN NPN(Bf=175)\n.model NOT_FOR_Q1 PNP(Bf=90)",
      }],
    });
    render(<ComponentInspector selected={selected} />);

    const chooser = screen.getByRole("combobox", { name: "Simulation model" }) as HTMLSelectElement;
    expect(Array.from(chooser.options).map((option) => option.textContent)).toContain("MY_NPN · transistors.lib");
    expect(Array.from(chooser.options).some((option) => option.textContent?.includes("NOT_FOR_Q1"))).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("Ready · exact NPN model from transistors.lib");
  });

  it("keeps an unresolved imported part visible and offers the library action", () => {
    const selected = {
      id: "m-missing",
      kind: "nmos" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "IRF540",
      label: "M1",
    };
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} onOpenModelLibraries={openLibraries} />);

    expect((screen.getByRole("combobox", { name: "Simulation model" }) as HTMLSelectElement).value).toBe("IRF540");
    expect(screen.getByRole("status").textContent).toMatch(/Needs a model ·.*won't substitute a generic NMOS/);
    fireEvent.click(screen.getByRole("button", { name: "Attach Model Library" }));
    expect(openLibraries).toHaveBeenCalledOnce();
  });
});

describe("ComponentInspector - native subcircuit chooser", () => {
  it("places the bundled Class-D driver with exact terminals and bounded named knobs", () => {
    const selected = {
      id: "x1", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "tau_passthrough", label: "X1",
    };
    useSchematic.setState({ components: [selected] });
    const { rerender } = render(<ComponentInspector selected={selected} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Subcircuit model" }), {
      target: { value: "TauDeadtimeDriver" },
    });

    expect(useSchematic.getState().components[0]).toMatchObject({
      value: "TauDeadtimeDriver",
      pinOverride: [
        { id: "p1", label: "vcc" },
        { id: "p2", label: "vee" },
        { id: "p3", label: "pwm" },
        { id: "p4", label: "gp" },
        { id: "p5", label: "gn" },
      ],
    });
    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);

    const dead = screen.getByRole("textbox", { name: "Dead time" }) as HTMLInputElement;
    expect(dead.value).toBe("200");
    expect((screen.getByRole("combobox", { name: "Dead time SI prefix" }) as HTMLSelectElement).value).toBe("n");
    expect((screen.getByRole("textbox", { name: "Input threshold" }) as HTMLInputElement).value).toBe("0.5");
    expect(screen.queryByRole("combobox", { name: "Input threshold SI prefix" })).toBeNull();
    expect(screen.getByText(/Blanking interval between one gate turning off/)).toBeTruthy();

    fireEvent.change(dead, { target: { value: "250" } });
    expect(useSchematic.getState().components[0].value).toBe("TauDeadtimeDriver dead=250n");
  });

  it("shows a named model contract and edits declared parameters without a raw Value field", () => {
    const selected = {
      id: "x1", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "deadtime DEAD=300n", label: "X1",
    };
    useSchematic.setState({
      components: [selected],
      directives: [`.subckt deadtime vcc vee pwm gp gn params: dead=250n\\n.ends deadtime`],
    });

    const { rerender } = render(<ComponentInspector selected={selected} />);
    const chooser = screen.getByRole("combobox", { name: "Subcircuit model" }) as HTMLSelectElement;
    expect(chooser.value).toBe("deadtime");
    expect(screen.getByRole("status").textContent).toContain("5 named terminals (vcc, vee, pwm, gp, gn)");
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();

    const dead = screen.getByRole("textbox", { name: "Subcircuit parameter dead" }) as HTMLInputElement;
    expect(dead.value).toBe("300n");
    fireEvent.change(dead, { target: { value: "400n" } });
    expect(useSchematic.getState().components[0].value).toBe("deadtime dead=400n");

    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Subcircuit model" }), { target: { value: "tau_passthrough" } });
    expect(useSchematic.getState().components[0]).toMatchObject({
      value: "tau_passthrough",
      pinOverride: [
        { id: "p1", label: "1" },
        { id: "p2", label: "2" },
      ],
    });
  });

  it("blocks an unresolved model and routes the user to Model Libraries", () => {
    const selected = {
      id: "x1", kind: "subckt" as const, x: 0, y: 0, rotation: 0 as const,
      value: "vendor_driver", label: "X1",
    };
    const openLibraries = vi.fn();
    useSchematic.setState({ components: [selected] });
    render(<ComponentInspector selected={selected} onOpenModelLibraries={openLibraries} />);

    expect(screen.getByRole("status").textContent).toContain("Run won't invent pins");
    fireEvent.click(screen.getByRole("button", { name: "Attach Model Library" }));
    expect(openLibraries).toHaveBeenCalledOnce();
  });
});

describe("ComponentInspector - charge-defined capacitor", () => {
  it("exposes named charge and initial-voltage controls instead of one raw Q= field", () => {
    const selected = {
      id: "c-q",
      kind: "capacitor" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "Q=100p*x*sin(2*pi*2K*time) IC=0.25",
      label: "C1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    const charge = screen.getByRole("textbox", { name: "Charge expression" }) as HTMLInputElement;
    const initialVoltage = screen.getByRole("textbox", { name: "Initial voltage" }) as HTMLInputElement;
    expect(charge.value).toBe("100p*x*sin(2*pi*2K*time)");
    expect(initialVoltage.value).toBe("0.25");
    expect(screen.queryByRole("textbox", { name: "Capacitance" })).toBeNull();

    fireEvent.change(charge, { target: { value: "200p*x" } });
    expect(useSchematic.getState().components[0].value).toBe("Q=200p*x IC=0.25");
  });
});

describe("ComponentInspector - independent source waveform controls", () => {
  it("renders PWL as a mode and point rows, never as a DC-level string", () => {
    const selected = {
      id: "v-pwl",
      kind: "vsource" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "PWL(0 0 2u 0 +1u 1) AC 2",
      label: "V6",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    render(<ComponentInspector selected={selected} />);

    const waveform = screen.getByRole("combobox", { name: "Waveform type" });
    expect(waveform.tagName).toBe("BUTTON");
    expect(waveform.getAttribute("data-slot")).toBe("select-trigger");
    expect(waveform.textContent).toContain("Piecewise linear");
    expect(document.querySelector(".source-value-editor select[aria-label='Waveform type']")).toBeNull();
    expect((screen.getByRole("textbox", { name: "DC operating point" }) as HTMLInputElement).value).toBe("0");
    expect((screen.getByRole("textbox", { name: "PWL time 3" }) as HTMLInputElement).value).toBe("+1");
    expect((screen.getByRole("combobox", { name: "PWL time 3 SI prefix" }) as HTMLSelectElement).value).toBe("u");
    expect((screen.getByRole("textbox", { name: "PWL level 3" }) as HTMLInputElement).value).toBe("1");
    expect((screen.getByRole("textbox", { name: "AC amplitude (.ac)" }) as HTMLInputElement).value).toBe("2");
    expect(screen.queryByRole("textbox", { name: "DC level" })).toBeNull();
    expect(screen.queryByDisplayValue(/PWL\(/)).toBeNull();
  });

  it("updates PWL rows and DC bias through controls", () => {
    const selected = {
      id: "v-pwl-edit",
      kind: "vsource" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "PWL(0 0 2u 0)",
      label: "V1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    const { rerender } = render(<ComponentInspector selected={selected} />);

    fireEvent.change(screen.getByRole("textbox", { name: "PWL level 2" }), { target: { value: "5" } });
    expect(useSchematic.getState().components[0].value).toBe("PWL(0 0 2u 5)");

    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);

    fireEvent.change(screen.getByRole("textbox", { name: "DC operating point" }), { target: { value: "2" } });
    expect(useSchematic.getState().components[0].value).toBe("DC 2 PWL(0 0 2u 5)");
  });

  it("switches waveform modes without requiring raw SINE syntax", async () => {
    const selected = {
      id: "i-dc",
      kind: "isource" as const,
      x: 160,
      y: 160,
      rotation: 0 as const,
      value: "5m",
      label: "I1",
    };
    useSchematic.setState({ components: [selected], selectedId: selected.id, selectedIds: [selected.id] });
    const { rerender } = render(<ComponentInspector selected={selected} />);

    const waveform = screen.getByRole("combobox", { name: "Waveform type" });
    expect(waveform.tagName).toBe("BUTTON");
    expect(waveform.getAttribute("data-slot")).toBe("select-trigger");
    expect(waveform.textContent).toContain("DC");
    // Radix Select opens on pointerdown; include button/pointerId so jsdom
    // matches the pointer-capture path used in the real UI.
    fireEvent.pointerDown(waveform, { button: 0, pointerId: 1, pointerType: "mouse" });
    const sine = await screen.findByRole("option", { name: "Sine" });
    fireEvent.pointerUp(sine, { button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.click(sine);
    expect(useSchematic.getState().components[0].value).toBe("SINE(5m 1 1k)");
    rerender(<ComponentInspector selected={useSchematic.getState().components[0]} />);
    expect(screen.getByRole("combobox", { name: "Waveform type" }).textContent).toContain("Sine");
    expect(screen.getByRole("textbox", { name: "Amplitude" })).toBeTruthy();
    expect(screen.queryByDisplayValue(/SINE\(/)).toBeNull();
    expect(document.querySelector(".source-value-editor select[aria-label='Waveform type']")).toBeNull();
  });
});

describe("ComponentsRail - responsive shell budget", () => {
  function Harness({ maxWidth, embedded = false }: { maxWidth: number; embedded?: boolean }) {
    const resize = usePanelWidth({
      storageKey: "tau.test.componentsRailWidth",
      defaultWidth: 264,
      minWidth: 208,
      maxWidth,
      edge: "left",
    });
    return <ComponentsRail focusSignal={0} onNotice={() => {}} resize={resize} maxWidth={maxWidth} embedded={embedded} />;
  }

  it("renders the responsive maximum immediately when the shell tightens", () => {
    const { rerender } = render(<Harness maxWidth={240} />);

    const panel = screen.getByRole("complementary", { name: "Components" });
    expect(panel.style.width).toBe("240px");
    expect(screen.getByRole("separator", { name: "Resize properties panel" }).getAttribute("aria-valuemax")).toBe("240");

    rerender(<Harness maxWidth={208} />);
    expect(panel.style.width).toBe("208px");
    expect(screen.getByRole("separator", { name: "Resize properties panel" }).getAttribute("aria-valuemax")).toBe("208");
  });

  it("delegates its width boundary to the shared dock when embedded", () => {
    render(<Harness maxWidth={340} embedded />);
    expect(screen.getByRole("complementary", { name: "Components" }).classList.contains("components-rail--embedded")).toBe(true);
    expect(screen.queryByRole("separator", { name: "Resize properties panel" })).toBeNull();
  });

  it("opens Library by default and returns there whenever the active sheet becomes empty", () => {
    render(<Harness maxWidth={340} embedded />);
    expect(screen.getByRole("tab", { name: "Library" }).getAttribute("aria-selected")).toBe("true");

    act(() => useSchematic.setState({
      components: [{ id: "r-1", kind: "resistor", x: 96, y: 0, rotation: 0, value: "1k", label: "R1" }],
      selectedId: "r-1",
      selectedIds: ["r-1"],
    }));
    expect(screen.getByRole("tab", { name: "Properties" }).getAttribute("aria-selected")).toBe("true");

    act(() => useSchematic.setState({ components: [], selectedId: null, selectedIds: [] }));
    expect(screen.getByRole("tab", { name: "Library" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByPlaceholderText("Filter")).toBeTruthy();
  });
});

describe("BottomPanel - errors tab states", () => {
  const failed = {
    ok: false,
    title: "Transient",
    message: "singular matrix at t=0",
    warnings: ["floating node n3"],
  } as AnalysisResult;

  it("shows a compact neutral diagnostic before a simulation has run", () => {
    const { container } = render(<BottomPanel result={null} />);
    expect(screen.getByRole("region", { name: "Simulation diagnostics" })).toBeTruthy();
    const clear = screen.getByRole("status");
    expect(clear.textContent).toContain("No analysis yet");
    expect(container.querySelector(".bottom-panel-state svg")).toBeTruthy();
    expect(screen.getByText("Diagnostics")).toBeTruthy();
    expect(container.querySelector(".bottom-panel.has-error")).toBeNull();
    expect(container.querySelector(".bottom-panel.is-idle")).toBeTruthy();
    expect(container.querySelector(".bottom-panel.is-clean")).toBeNull();
    expect(container.querySelector(".bottom-panel.is-collapsed")).toBeTruthy();
    expect(container.querySelector(".bottom-panel-count")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Errors/ })).toBeNull();
    expect(container.querySelector(".bottom-errors")).toBeNull();
  });

  it("uses the mint all-clear state only after a successful run", () => {
    const result: AnalysisResult = {
      ok: true,
      title: "Transient",
      times: [0],
      traces: [],
      currents: [],
      stats: { netCount: 0, componentCount: 0, sampleCount: 1, stopTime: 0, stepSize: 0 },
      warnings: [],
      circuit: {} as never,
    };
    const { container } = render(<BottomPanel result={result} />);
    expect(screen.getByRole("status").textContent).toContain("No issues");
    expect(container.querySelector(".bottom-panel.is-clean")).toBeTruthy();
    expect(container.querySelector(".bottom-panel.is-idle")).toBeNull();
  });

  it("uses the amber running state instead of stale idle, success, or error diagnostics", () => {
    const clean = {
      ok: true,
      title: "Transient",
      times: [0],
      traces: [],
      currents: [],
      stats: { netCount: 0, componentCount: 0, sampleCount: 1, stopTime: 0, stepSize: 0 },
      warnings: [],
      circuit: {} as never,
    } as AnalysisResult;
    const { container, rerender } = render(<BottomPanel result={clean} isRunning />);

    const assertRunningOnly = () => {
      expect(screen.getByRole("status").textContent).toBe("Running");
      expect(container.querySelector(".bottom-panel.is-running")).toBeTruthy();
      expect(container.querySelector(".bottom-panel.is-idle")).toBeNull();
      expect(container.querySelector(".bottom-panel.is-clean")).toBeNull();
      expect(container.querySelector(".bottom-panel.has-error")).toBeNull();
      expect(container.querySelector(".bottom-errors")).toBeNull();
    };

    assertRunningOnly();
    rerender(<BottomPanel result={null} isRunning />);
    assertRunningOnly();
    rerender(<BottomPanel result={failed} isRunning />);
    assertRunningOnly();
  });

  it("toggles an issue body from its emphasized header button", () => {
    render(<BottomPanel result={failed} />);
    const toggle = screen.getByRole("button", { name: /^Errors/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole("alert").textContent).toContain("singular matrix");
  });

  it("reopens when a newly reported issue replaces a collapsed one", () => {
    const { rerender } = render(<BottomPanel result={failed} />);
    const toggle = screen.getByRole("button", { name: /^Errors/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    rerender(<BottomPanel result={{ ...failed, message: "timestep too small" } as AnalysisResult} />);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("timestep too small");
  });

  it("goes loud with an error token and a count when the run fails", () => {
    const { container } = render(<BottomPanel result={failed} />);
    expect(container.querySelector(".bottom-panel.has-error")).toBeTruthy();
    // message + warning = 2, in the alarm-red (not warnings-only) badge
    const count = container.querySelector(".bottom-panel-count")!;
    expect(count.textContent).toBe("2");
    expect(count.classList.contains("warnings-only")).toBe(false);
    expect(screen.getByRole("alert").textContent).toBe("singular matrix at t=0");
  });

  it("uses the amber warnings-only badge when the run succeeded with warnings", () => {
    const ok = {
      ok: true,
      title: "Transient",
      times: [0],
      traces: [],
      currents: [],
      stats: { netCount: 1, componentCount: 1, sampleCount: 1, stopTime: 1, stepSize: 1 },
      warnings: ["R2 shorted by wire"],
      circuit: {} as never,
    } as AnalysisResult;
    const { container } = render(<BottomPanel result={ok} />);
    expect(container.querySelector(".bottom-panel.has-warning")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Warnings/ })).toBeTruthy();
    const count = container.querySelector(".bottom-panel-count")!;
    expect(count.textContent).toBe("1");
    expect(count.classList.contains("warnings-only")).toBe(true);
    expect(container.querySelector(".bottom-panel.has-error")).toBeNull();
  });
});
