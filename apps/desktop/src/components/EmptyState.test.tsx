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


  it("does not tell a reader to place their first component when their file's only part was skipped (DIAG)", () => {
    // The card's render gate is components === 0 && wires === 0, which an
    // import whose every part was unmappable satisfies - so this copy fired on
    // a sheet that was empty BECAUSE something was thrown away, next to a dock
    // refusing a run over that same part.
    render(
      <EmptyState
        projectOpen
        schematicOpen
        unimportedParts={["A1 (dflop)"]}
        onShowParts={vi.fn()}
        onAskBode={vi.fn()}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1 }).textContent ?? "";
    expect(heading).not.toBe("Place your first component");
    const card = screen.getByRole("region", { name: "Empty schematic" });
    // Names the part, so the sentence is actionable rather than just apologetic.
    expect(card.textContent).toContain("A1 (dflop)");
    // And says the record survives a save, which is the fact that reconciles
    // this card with the dock's refusal row.
    expect(card.textContent).toMatch(/keeps|kept/i);
  });

  /**
   * The card knows about parts and nothing else, so its claim has to stop there.
   *
   * Its render gate is components === 0 && wires === 0 - which a file's
   * directives, comments and text annotations all pass through untouched
   * (ascImport.test.ts, "still imports directives and on-canvas annotations from
   * a file whose only part was skipped"). A text annotation is drawn on the
   * canvas UNDER this card, so "nothing in the file could be imported" is
   * contradicted by the sheet the reader is looking at - the same
   * surfaces-disagree defect one layer down.
   */
  it("scopes its claim to parts, not to the whole file (DIAG)", () => {
    render(
      <EmptyState
        projectOpen
        schematicOpen
        unimportedParts={["A1 (dflop)"]}
        onShowParts={vi.fn()}
        onAskBode={vi.fn()}
      />,
    );
    const card = screen.getByRole("region", { name: "Empty schematic" });
    expect(card.textContent).not.toMatch(/nothing in (the|this) file/i);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/part/i);
  });

  it("keeps 'Place your first component' for a genuinely fresh sheet (DIAG)", () => {
    render(<EmptyState projectOpen schematicOpen onShowParts={vi.fn()} onAskBode={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Place your first component");
  });

  it("leaves the no-project variant alone - 'Open a project folder' is still correct there", () => {
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Open a project folder");
  });

  // The heading here reads "Create a schematic" rather than the "Create or
  // open a schematic" P3-04B left behind. Item 5 retired the "or open" half:
  // Explorer is not a thing you open, and this card never had a button for
  // opening a file. What this assertion is for is unchanged - the two variants
  // must not share one headline again.
  it("keeps the 'project open, no schematic' variant on its own copy (schematicOpen defaults off)", () => {
    render(<EmptyState projectOpen onNewCircuit={vi.fn()} onAskBode={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Create a schematic");
    expect(screen.getByRole("button", { name: "New schematic" })).toBeTruthy();
  });
});

/**
 * PDF-6 item 5: "i beliebe this text box is outdated in the contents make it
 * have a better flow maintian consistency."
 *
 * Three of the four cards were describing an app that has moved:
 *
 * - "open from Explorer" made a gesture out of a panel that App.tsx keeps open
 *   beside this card (`intent: { explorer: true }`), and that this card has no
 *   button for. DESIGN_SYSTEM 4: "If the copy mentions three ways in, there are
 *   three buttons or the copy is wrong."
 * - "ask Bode about the circuit" named a circuit that does not exist on either
 *   screen it appeared on. With nothing placed, Bode's own two suggestions are
 *   "Build an RC filter" and "Build an LC tank".
 * - "the diagnostics below refuse to simulate" pointed under a card at a window
 *   that is now mounted only while the rail's lamp is lit (`diagnosticsOpen`
 *   starts false), so the reader was sent to look at empty space.
 *
 * Every assertion below pins the replacement, so a revert to the old wording
 * fails here rather than in a screenshot nobody reads.
 */
function cardCopy() {
  const card = screen.getByRole("region", { name: "Empty schematic" });
  const flat = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  return {
    heading: flat(screen.getByRole("heading", { level: 1 }).textContent),
    body: [...card.querySelectorAll("p")].map((p) => flat(p.textContent)).join(" "),
    // The actions row only. The kicker and the hidden file input are not
    // routes, and counting them would make "exactly these actions" untestable.
    buttons: [...card.querySelectorAll<HTMLButtonElement>(".empty-state-actions button")]
      .map((button) => flat(button.textContent)),
    text: flat(card.textContent),
  };
}

describe("EmptyState copy (PDF-6 item 5)", () => {
  it("tells a reader with no project what an import does with their file", () => {
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} />);
    const copy = cardCopy();
    expect(copy.heading).toBe("Open a project folder");
    expect(copy.body).toBe(
      "Tau keeps every schematic inside a project folder. "
      + "An imported circuit is copied into it and the original file is left alone.",
    );
    // The retired half was the two buttons under it read aloud.
    expect(copy.body).not.toMatch(/open one to start/i);
    expect(copy.body).not.toMatch(/or import an existing/i);
  });

  /**
   * Both withheld actions are real refusals, not oversights: the assistant
   * panel is gated on `projectRootPath` (App.tsx), and
   * `startFirstSuccessExample` answers with "Open or create a project folder
   * before trying the RC example." A button for either here would be a control
   * that cannot do its job.
   */
  it("offers only the actions a reader with no project can actually perform", () => {
    render(
      <EmptyState
        projectOpen={false}
        canCreateProject
        onOpenFolder={vi.fn()}
        onCreateProject={vi.fn()}
        onAskBode={vi.fn()}
        offerFirstSuccess
        onTryFirstSuccess={vi.fn()}
      />,
    );
    expect(cardCopy().buttons).toEqual(["Open folder", "Import circuit", "Create project"]);
  });

  it("drops the Create project action on a build that cannot create one", () => {
    render(<EmptyState projectOpen={false} onOpenFolder={vi.fn()} />);
    expect(cardCopy().buttons).toEqual(["Open folder", "Import circuit"]);
  });

  it("points a reader with a project at Explorer instead of inventing a gesture for it", () => {
    render(<EmptyState projectOpen onNewCircuit={vi.fn()} onAskBode={vi.fn()} />);
    const copy = cardCopy();
    expect(copy.heading).toBe("Create a schematic");
    expect(copy.body).toBe(
      "Tau saves it as a file in the open project folder. "
      + "Explorer lists whatever that folder already holds.",
    );
    expect(copy.body).not.toMatch(/open from Explorer/i);
    // Named no place the reader could look, and no action they could take.
    expect(copy.body).not.toMatch(/Schematics live in this project/i);
    // There is no circuit on this screen to ask about.
    expect(copy.text).not.toMatch(/ask Bode about the circuit/i);
    expect(copy.buttons).toEqual(["New schematic", "Ask Bode"]);
  });

  it("leaves the learning path to its button, under the headline's own action", () => {
    render(
      <EmptyState
        projectOpen
        onNewCircuit={vi.fn()}
        onAskBode={vi.fn()}
        offerFirstSuccess
        onTryFirstSuccess={vi.fn()}
      />,
    );
    const copy = cardCopy();
    // The paragraph does not grow a fourth route when the CTA appears.
    expect(copy.body).toBe(
      "Tau saves it as a file in the open project folder. "
      + "Explorer lists whatever that folder already holds.",
    );
    expect(copy.buttons).toEqual(["New schematic", "Try RC Charging", "Ask Bode"]);
  });

  it("gives the empty sheet the gesture no button label can carry", () => {
    render(<EmptyState projectOpen schematicOpen onShowParts={vi.fn()} onAskBode={vi.fn()} />);
    const copy = cardCopy();
    expect(copy.heading).toBe("Place your first component");
    expect(copy.body).toBe(
      "Parts come from the Components panel. Pick one there, then click the sheet to place it.",
    );
    // The rail is an overlay `resolveChrome` can withhold, so its side of the
    // window is not a fact the copy may assert.
    expect(copy.body).not.toMatch(/on the right/i);
    // And the trailing clause was the Ask Bode button read aloud.
    expect(copy.body).not.toMatch(/ask Bode/i);
    expect(copy.buttons).toEqual(["Browse components", "Ask Bode"]);
  });

  it("stops sending a reader to a diagnostics window that is not on screen (DIAG)", () => {
    render(
      <EmptyState
        projectOpen
        schematicOpen
        unimportedParts={["A1 (dflop)"]}
        onShowParts={vi.fn()}
        onAskBode={vi.fn()}
      />,
    );
    const copy = cardCopy();
    expect(copy.heading).toBe("No part in this file could be imported");
    expect(copy.body).toBe(
      "A1 (dflop) is the only part this file contained, and Tau has no model for it. "
      + "Tau keeps that record when you save, so nothing is lost on disk, "
      + "but this circuit will not run until it is replaced or mapped to a subcircuit.",
    );
    // Nothing is below this card until the rail lamp is pressed.
    expect(copy.text).not.toMatch(/diagnostics/i);
    // And the words are the lamp's own (`diagnosticsHealthLabel`), so the card
    // and the window agree once the reader does open it.
    expect(copy.body).toContain("this circuit will not run");
  });

  it("agrees with itself in the plural (DIAG)", () => {
    render(
      <EmptyState
        projectOpen
        schematicOpen
        unimportedParts={["A1 (dflop)", "A2 (dflop)"]}
        onShowParts={vi.fn()}
        onAskBode={vi.fn()}
      />,
    );
    const copy = cardCopy();
    expect(copy.heading).toBe("No part in this file could be imported");
    expect(copy.body).toBe(
      "A1 (dflop), A2 (dflop) came in with no Tau model, and they were all this file contained. "
      + "Tau keeps those records when you save, so nothing is lost on disk, "
      + "but this circuit will not run until they are replaced or mapped to a subcircuit.",
    );
  });

  /**
   * DESIGN_SYSTEM 6, applied to every state at once: no exclamation marks, no
   * em dashes in shipped strings, and never the implementation's name for a
   * thing. "first-success" is what the code calls the RC example
   * (`offerFirstSuccess`, `startFirstSuccessExample`), and the old copy printed
   * it: "try the RC Charging first-success example".
   */
  it("holds every state to the house voice", () => {
    const states = [
      <EmptyState key="none" projectOpen={false} canCreateProject onOpenFolder={vi.fn()} />,
      <EmptyState key="project" projectOpen offerFirstSuccess onNewCircuit={vi.fn()} onAskBode={vi.fn()} />,
      <EmptyState key="sheet" projectOpen schematicOpen offerFirstSuccess onShowParts={vi.fn()} />,
      <EmptyState
        key="skipped"
        projectOpen
        schematicOpen
        unimportedParts={["A1 (dflop)"]}
        onShowParts={vi.fn()}
      />,
    ];
    for (const state of states) {
      const { unmount } = render(state);
      const { text } = cardCopy();
      expect(text).not.toMatch(/—/);
      expect(text).not.toMatch(/!/);
      expect(text).not.toMatch(/\bsimply\b|\bjust\b/i);
      expect(text).not.toMatch(/first.success/i);
      unmount();
    }
  });
});
