// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmptyState } from "./EmptyState";
import { useProject } from "../store/useProject";
import { useSchematic } from "../store/useSchematic";

const originalProjectActions = {
  detectCapability: useProject.getState().detectCapability,
  ensureDefaultWorkspace: useProject.getState().ensureDefaultWorkspace,
};

beforeEach(() => {
  useProject.setState({
    rootPath: null,
    rootName: null,
    tree: [],
    expanded: [],
    error: null,
    capability: "none",
    workspaceFiles: {},
    ...originalProjectActions,
  });
  useSchematic.setState({ userModelLibraries: [], past: [], future: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fileFrom(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return { name, arrayBuffer: async () => bytes.buffer } as File;
}

describe("EmptyState no-project import action", () => {
  it("gives every prose action a real button when no project is open (folder, import)", () => {
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Open folder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import circuit" })).toBeTruthy();
  });

  it("does not show the no-project Import action once a schematic can be created directly", () => {
    render(<EmptyState projectOpen onNewCircuit={vi.fn()} onAskBode={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Import circuit" })).toBeNull();
    expect(screen.getByRole("button", { name: "New schematic" })).toBeTruthy();
  });

  it("imports a dropped .asc into a freshly seeded workspace and opens it", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const onOpenAscText = vi.fn();
    const onNotice = vi.fn();
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} onOpenAscText={onOpenAscText} onNotice={onNotice} />);

    const source = "Version 4\nSHEET 1 880 680\n";
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [fileFrom("existing.asc", source)] } });

    await waitFor(() => expect(onOpenAscText).toHaveBeenCalledWith(
      expect.stringMatching(/existing\.asc$/),
      "existing.asc",
      source,
    ));
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("Imported"));
  });

  it("converts a dropped SPICE netlist and passes its conversion warnings through to onOpenAscText", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const onOpenAscText = vi.fn();
    const onNotice = vi.fn();
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} onOpenAscText={onOpenAscText} onNotice={onNotice} />);

    const source = "* t\nR1 a 0 1k\nX1 a b mysub\n.end\n";
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [fileFrom("board.cir", source)] } });

    await waitFor(() => expect(onOpenAscText).toHaveBeenCalled());
    const call = onOpenAscText.mock.calls[0];
    expect(call[0]).toMatch(/board\.asc$/);
    expect(call[3]).toEqual(expect.arrayContaining([expect.stringContaining("X1")]));
  });

  it("refuses to attach a dropped model library since no schematic can be open on this screen", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const onNotice = vi.fn();
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} onNotice={onNotice} />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [fileFrom("vendor.lib", ".subckt FOO a b\nR1 a b 1k\n.ends\n")] } });

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(
      "Open or create a schematic before attaching a vendor model file.",
    ));
    expect(useSchematic.getState().userModelLibraries).toEqual([]);
  });

  it("explains precisely when a dropped file is not something Tau can import", async () => {
    useProject.getState().ensureDefaultWorkspace();
    const onNotice = vi.fn();
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} onNotice={onNotice} />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [fileFrom("photo.png", "hello")] } });

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringContaining("does not recognize")));
  });
});

/**
 * P3-04B. The card has two call sites in App.tsx and, until now, two variants
 * for three situations: "no project open", "project open but no schematic",
 * and "a schematic that is open and empty". The third reused the second's
 * copy, so a reader already inside an empty schematic was told to create or
 * open one. `schematicOpen` selects the third variant; it defaults to false so
 * neither existing call site changes meaning.
 *
 * The first two assertions are the two predicates scripts/pdf3-verify.mjs:441
 * measures, restated here so the copy cannot regress without a unit test going
 * red first.
 */
/**
 * jsdom implements no `AnimationEvent`, so `fireEvent.animationEnd` degrades to
 * a bare `Event` and silently drops `animationName` - a handler that reads it
 * would see `undefined` no matter what the test passed. Building the event by
 * hand is the only way to model what a browser actually delivers.
 */
function endAnimation(target: Element, animationName: string) {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  target.dispatchEvent(event);
}

describe("EmptyState inside an open, empty schematic (P3-04B)", () => {
  it("stops telling a reader already inside a schematic to create or open one", () => {
    render(<EmptyState projectOpen schematicOpen onShowParts={vi.fn()} onAskBode={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(heading).not.toMatch(/create or open a schematic/i);
    const body = document.querySelector(".empty-state")?.textContent ?? "";
    expect(body).toMatch(/place|drop|drag/i);
    expect(body).toMatch(/component|part/i);
  });

  it("names the Components rail by the label the product uses, not the implementation", () => {
    render(<EmptyState projectOpen schematicOpen onShowParts={vi.fn()} onAskBode={vi.fn()} />);
    const body = document.querySelector(".empty-state")?.textContent ?? "";
    expect(body).toMatch(/Components/);
    expect(body).not.toMatch(/parts rail|palette/i);
  });

  it("reveals the Components rail from the primary action and keeps Ask Bode secondary", () => {
    const onShowParts = vi.fn();
    render(<EmptyState projectOpen schematicOpen onShowParts={onShowParts} onAskBode={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Browse components/i }));
    expect(onShowParts).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /Ask Bode/i })).toBeTruthy();
  });

  it("pulses the rail once by stamping the stage, and clears the stamp so it can fire again", () => {
    const stage = document.createElement("main");
    stage.className = "stage";
    document.body.appendChild(stage);
    render(<EmptyState projectOpen schematicOpen onShowParts={vi.fn()} onAskBode={vi.fn()} />, {
      container: stage.appendChild(document.createElement("div")),
    });
    fireEvent.click(screen.getByRole("button", { name: /Browse components/i }));
    expect(stage.getAttribute("data-parts-flash")).toBe("1");
    endAnimation(stage, "tau-parts-flash");
    expect(stage.getAttribute("data-parts-flash")).toBeNull();
    stage.remove();
  });

  /**
   * `animationend` bubbles. The stamp lives on `.stage`, which is the whole
   * canvas area - the run-progress overlay, the parts rail and the canvas all
   * sit inside it - so an unfiltered listener would clear the attribute the
   * first time ANY descendant animation finished, cutting the pulse short or
   * removing it before it ever painted. The listener has to name its own
   * keyframes.
   */
  it("ignores an unrelated descendant animation finishing inside the stage", () => {
    const stage = document.createElement("main");
    stage.className = "stage";
    document.body.appendChild(stage);
    render(<EmptyState projectOpen schematicOpen onShowParts={vi.fn()} onAskBode={vi.fn()} />, {
      container: stage.appendChild(document.createElement("div")),
    });
    fireEvent.click(screen.getByRole("button", { name: /Browse components/i }));
    const bystander = stage.appendChild(document.createElement("div"));
    endAnimation(bystander, "run-overlay-sweep");
    expect(stage.getAttribute("data-parts-flash")).toBe("1");
    endAnimation(stage, "tau-parts-flash");
    expect(stage.getAttribute("data-parts-flash")).toBeNull();
    stage.remove();
  });

  it("leaves the no-project variant alone - 'Open a project folder' is still correct there", () => {
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Open a project folder");
  });

  it("keeps the 'project open, no schematic' variant on its own copy (schematicOpen defaults off)", () => {
    render(<EmptyState projectOpen onNewCircuit={vi.fn()} onAskBode={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Create or open a schematic");
    expect(screen.getByRole("button", { name: "New schematic" })).toBeTruthy();
  });
});
