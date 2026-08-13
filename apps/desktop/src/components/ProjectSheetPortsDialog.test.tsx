// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectSheetPortsEditor } from "./ProjectSheetPortsDialog";
import { useSchematic } from "../store/useSchematic";

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

    fireEvent.click(screen.getByRole("button", { name: "Add project port" }));
    expect(useSchematic.getState().projectPorts).toEqual([
      { name: "IN", labelId: "in-label", direction: "In" },
    ]);
    expect(screen.getByRole("combobox", { name: "Port 1 label mapping" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Port 1 direction" })).toBeTruthy();

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
    fireEvent.click(screen.getByRole("button", { name: "Add project port" }));
    fireEvent.click(screen.getByRole("button", { name: "Add project port" }));

    expect(useSchematic.getState().projectPorts.map((port) => port.name)).toEqual(["IN", "OUT"]);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Move port 2 up" })));

    expect(useSchematic.getState().projectPorts).toEqual([
      { name: "OUT", labelId: "out-label", direction: "Out" },
      { name: "IN", labelId: "in-label", direction: "In" },
    ]);
    expect(screen.getAllByRole("textbox", { name: /Port \d name/ })[0]).toHaveProperty("value", "OUT");
  });
});
