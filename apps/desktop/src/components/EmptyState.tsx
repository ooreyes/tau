import { useRef, type ChangeEvent } from "react";
import { BodeMascot } from "./BodeMascot";
import { FolderOpen, FolderPlus, Import, MessageSquare, Plus, Waypoints, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { importDroppedFile } from "../io/fileImport";
import { IMPORT_ACCEPT, IMPORT_BUTTON_LABEL } from "../io/importUi";

/**
 * The keyframes `styles/editorToolbarIcons.css` runs on the Components rail.
 * Named here because the `animationend` handler below has to tell its own
 * pulse apart from every other animation that bubbles up through `.stage`.
 */
const PARTS_FLASH_KEYFRAMES = "tau-parts-flash";

export function EmptyState({
  projectOpen = true,
  schematicOpen = false,
  canCreateProject = false,
  onOpenFolder,
  onCreateProject,
  onNewCircuit,
  onAskBode,
  onShowParts,
  onOpenAscText,
  onNotice,
  offerFirstSuccess = false,
  onTryFirstSuccess,
  unimportedParts = [],
}: {
  projectOpen?: boolean;
  /**
   * True only at App.tsx's SECOND call site: a schematic is open and it is
   * empty. There are three situations and there used to be two variants, so
   * that call site borrowed the "project open, no schematic" copy and told a
   * reader already inside a schematic to create or open one (P3-04B). Defaults
   * to false so the other call site, where that copy is correct, is unchanged.
   */
  schematicOpen?: boolean;
  canCreateProject?: boolean;
  onOpenFolder?: () => void;
  onCreateProject?: () => void;
  onNewCircuit?: () => void;
  onAskBode?: () => void;
  /** Reveals and focuses the Components rail. Must be set-open-and-focus, not
   *  a toggle: the rail is often already open behind this card, and a toggle
   *  would close the panel the copy just pointed at. */
  onShowParts?: () => void;
  /** Opens an imported schematic once it has been written into the project -
   *  same contract `ExplorerPanel` uses, so App.tsx can pass one function to
   *  both. Only needed for the no-project Import action below. */
  onOpenAscText?: (path: string, title: string, text: string, extraWarnings?: string[]) => void | Promise<void>;
  onNotice?: (message: string) => void;
  /** First-success learning path CTA (product-gates slice). */
  offerFirstSuccess?: boolean;
  onTryFirstSuccess?: () => void;
  /**
   * Parts the open file DID contain and the import could not represent, named
   * as the dock names them ("A1 (dflop)").
   *
   * The card's gate is "no components and no wires", which an import whose
   * every part was unmappable satisfies - so a sheet that is empty *because*
   * something was thrown away got the same "place your first component" copy as
   * a brand-new one, while the dock beside it refused to simulate over exactly
   * those parts. Empty for a genuinely fresh sheet, and that variant is
   * unchanged.
   */
  unimportedParts?: readonly string[];
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  /**
   * Reveal the rail, then pulse it once (P3-04B).
   *
   * The pulse is stamped as a data attribute on the enclosing `.stage` rather
   * than pushed through a prop: `ComponentsRail` takes no className, so the
   * stage is the nearest ancestor a stylesheet this lane owns can reach, and
   * driving it from here means App.tsx needs no extra state.
   *
   * Cleared on animationend so a second click pulses again. The timeout is the
   * fallback that matters: under `prefers-reduced-motion: reduce` the rule sets
   * `animation: none`, so animationend never fires and the attribute would
   * otherwise stick forever. Both paths clear the same attribute, and clearing
   * twice is harmless.
   *
   * The listener names its own keyframes because `animationend` bubbles and the
   * stage is the whole canvas area - the run-progress overlay, the rail and the
   * canvas all live under it, so an unfiltered handler would clear the stamp on
   * the first unrelated animation to finish. The pending timeout is cancelled
   * on re-entry for the same reason: a second click within 900 ms would
   * otherwise be cut short by the first click's timer.
   */
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleShowParts = () => {
    onShowParts?.();
    const stage = rootRef.current?.closest(".stage");
    if (!(stage instanceof HTMLElement)) return;
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    stage.setAttribute("data-parts-flash", "1");
    const clear = () => {
      stage.removeAttribute("data-parts-flash");
      stage.removeEventListener("animationend", onEnd);
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
      flashTimer.current = null;
    };
    const onEnd = (event: AnimationEvent) => {
      if (event.animationName === PARTS_FLASH_KEYFRAMES) clear();
    };
    stage.addEventListener("animationend", onEnd);
    flashTimer.current = setTimeout(clear, 900);
  };

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    // No project is open on this screen, so a schematic could not possibly be
    // open either - a dropped vendor model file is refused, not attached.
    const outcome = await importDroppedFile(file, { hasActiveSchematic: false });
    if (outcome.kind === "error") {
      onNotice?.(outcome.message);
      return;
    }
    if (outcome.kind === "model-library") {
      onNotice?.(`Attached ${outcome.name}`);
      return;
    }
    onNotice?.(`Imported ${outcome.path.split("/").pop() ?? outcome.path}`);
    const title = outcome.path.split("/").pop() ?? outcome.path;
    if (outcome.warnings.length > 0) await onOpenAscText?.(outcome.path, title, outcome.text, outcome.warnings);
    else await onOpenAscText?.(outcome.path, title, outcome.text);
  };

  /**
   * The sheet is empty because the import dropped everything on it, not because
   * nobody has drawn anything yet. Only meaningful inside an open schematic:
   * the no-project and no-schematic variants describe a shell with no document
   * behind them, so a part list could not belong to either.
   */
  const skippedParts = schematicOpen ? unimportedParts : [];
  // Long imports name the first few and count the rest: the point is to prove
  // the file was not empty and give a handle to search for, not to reprint a
  // list the dock already prints in full, one actionable row per part.
  const skippedSummary = skippedParts.slice(0, 3).join(", ")
    + (skippedParts.length > 3 ? `, and ${skippedParts.length - 3} more` : "");

  return (
    <section className="empty-state" aria-label="Empty schematic" ref={rootRef}>
      <div className="empty-panel">
        <div className="empty-kicker">
          <BodeMascot className="bode-empty-mascot" aria-hidden="true" />
          {/* One flex item, not three: .empty-kicker gaps its children, so a
              bare text node after the brand would space the comma off it. */}
          <span><span className="empty-brand">Bode</span> · circuit assistant</span>
        </div>
        {/*
          * Four situations, four headlines, and one shape for all of them: the
          * headline names the single next action this card has a filled button
          * for (DESIGN_SYSTEM 4), and the paragraph under it carries the one
          * fact about this surface that no button label can. Before item 5 the
          * paragraphs instead listed the routes in - "Create one, open from
          * Explorer, or ask Bode" - which restated the buttons beside them,
          * restated the headline above them, and advertised a route that has no
          * control (see the "Create a schematic" branch below).
          *
          * The import failure is the one headline that reports rather than
          * instructs, because what happened is what the reader needs first.
          */}
        <h1>
          {!projectOpen
            ? "Open a project folder"
            : schematicOpen
              ? skippedParts.length > 0
                // "No part", not "nothing": the render gate is components and
                // wires, and a file's directives, comments and text annotations
                // all import past it - an annotation is drawn on the canvas
                // directly under this card, so the wider claim is refuted by
                // the sheet the reader is looking at.
                //
                // It no longer opens with "This sheet is empty:" either. The
                // reader is looking at the empty sheet; at 22px in a 420px card
                // that preamble cost a third line to say what the canvas
                // behind it already says.
                ? "No part in this file could be imported"
                : "Place your first component"
              // Not "Create or open a schematic": Explorer is not a thing you
              // open (App.tsx pins its intent to true, so it is already on the
              // left in schematic mode), and this card has no button for
              // opening a file - so the old headline named two actions, offered
              // one, and made a gesture out of a panel that is already visible.
              // The paragraph points at that panel instead.
              : "Create a schematic"}
        </h1>
        {projectOpen && schematicOpen ? (
          <>
            {skippedParts.length > 0 ? (
              <p>
                {skippedParts.length === 1
                  ? `${skippedSummary} is the only part this file contained, and Tau has no model for it.`
                  : `${skippedSummary} came in with no Tau model, and they were all this file contained.`}
                {/*
                  * "this circuit will not run", not "the diagnostics below
                  * refuse to simulate". Nothing is below: the errors window is
                  * mounted only while the rail's lamp is lit (App.tsx gates the
                  * drawer on `diagnosticsOpen`, which starts false), so the old
                  * sentence sent the reader to look at empty space. This card
                  * is now the surface carrying that fact, and it borrows the
                  * lamp's own words for it - `diagnosticsHealthLabel` says
                  * "this circuit will not run" - so the two agree when the
                  * reader does open the window. The em dash went with it:
                  * DESIGN_SYSTEM 6 keeps them out of shipped strings.
                  */}
                {" "}Tau keeps {skippedParts.length === 1 ? "that record" : "those records"} when you
                save, so nothing is lost on disk, but this circuit will not run
                until {skippedParts.length === 1 ? "it is" : "they are"} replaced
                or mapped to a subcircuit.
              </p>
            ) : (
              // Where parts come from, then the gesture - which is the half no
              // button can carry. "Browse components" reveals the panel; only
              // the copy can say that a part is chosen there and landed with a
              // click on the sheet. The old "on the right" went because the
              // rail is a summoned overlay that `resolveChrome` can withhold at
              // narrow widths, and the trailing "or ask Bode to build the
              // circuit for you" went because it was the Ask Bode button read
              // aloud, over a sheet with no circuit on it yet.
              <p>
                Parts come from the Components panel. Pick one there, then click
                the sheet to place it.
              </p>
            )}
            <div className="empty-state-actions">
              {/* The single filled control, per DESIGN_SYSTEM 4: the next
                  action is to find a part, not to make another schematic. */}
              <Button type="button" size="sm" onClick={handleShowParts}>
                <LayoutGrid aria-hidden="true" /> Browse components
              </Button>
              {/* The learning path survives the variant split. App.tsx passes
                  offerFirstSuccess to BOTH call sites, and before this variant
                  existed this card fell through to the branch below, so an
                  open empty schematic did offer it - dropping it here would
                  have quietly deleted the first-success route from the one
                  screen a first-time user lands on. Outline, not filled,
                  because the headline names browsing: this is the alternative
                  route to a first result, not the card's own action. */}
              {offerFirstSuccess && (
                <Button type="button" size="sm" variant="outline" onClick={onTryFirstSuccess}>
                  <Waypoints aria-hidden="true" /> Try RC Charging
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={onAskBode}>
                <MessageSquare aria-hidden="true" /> Ask Bode
              </Button>
            </div>
          </>
        ) : projectOpen ? (
          <>
            {/*
              * Where the file lands, then where the ones already there are
              * listed. Both halves replace something that could not be acted
              * on: "Schematics live in this project" named no place the reader
              * could look, and "open from Explorer" made a gesture out of a
              * panel that is already open beside this card - a reader who
              * followed it went hunting for a control that does not exist.
              * Naming what Explorer holds keeps the route without pretending it
              * is a button, and it stays true on a fresh folder, where the tree
              * is one root row with nothing under it.
              *
              * The learning path is not mentioned. It has a button, the button
              * says what it does, and the example's internal name for itself
              * ("first-success") is implementation the reader should never see
              * (DESIGN_SYSTEM 6).
              */}
            <p>
              Tau saves it as a file in the open project folder. Explorer lists
              whatever that folder already holds.
            </p>
            <div className="empty-state-actions">
              {/* New schematic keeps the filled recipe even while the learning
                  path is on offer, because it is the action the headline names.
                  That is the rule the open-empty-sheet card above already
                  follows - Browse components filled, Try RC Charging outline -
                  and the two cards used to disagree about it, so the reader
                  learned one button shape here and a different one on the very
                  next screen. Order follows weight for the same reason. */}
              <Button type="button" size="sm" onClick={onNewCircuit}>
                <Plus aria-hidden="true" /> New schematic
              </Button>
              {offerFirstSuccess && (
                <Button type="button" size="sm" variant="outline" onClick={onTryFirstSuccess}>
                  <Waypoints aria-hidden="true" /> Try RC Charging
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={onAskBode}>
                <MessageSquare aria-hidden="true" /> Ask Bode
              </Button>
            </div>
          </>
        ) : (
          <>
            {/*
              * The first sentence is the only one on this card that was already
              * doing work - it says why a folder is being asked for at all - so
              * it stays. What followed it ("Open one to start, or import an
              * existing schematic or SPICE netlist") was the two buttons under
              * it read aloud, and it left the third, Create project, unnamed.
              *
              * In its place, the fact importing raises and no button label can
              * answer: `importDroppedFile` writes a copy into the project and
              * never touches the file the reader picked. On the screen where
              * someone is about to hand Tau an LTspice sheet they care about,
              * that is the sentence they need.
              */}
            <p>
              Tau keeps every schematic inside a project folder. An imported
              circuit is copied into it and the original file is left alone.
            </p>
            <div className="empty-state-actions">
              <Button type="button" size="sm" onClick={onOpenFolder}>
                <FolderOpen aria-hidden="true" /> Open folder
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => importInputRef.current?.click()}>
                <Import aria-hidden="true" /> {IMPORT_BUTTON_LABEL}
              </Button>
              {canCreateProject && (
                <Button type="button" size="sm" variant="outline" onClick={onCreateProject}>
                  <FolderPlus aria-hidden="true" /> Create project
                </Button>
              )}
            </div>
            <input
              ref={importInputRef}
              className="file-input"
              type="file"
              accept={IMPORT_ACCEPT}
              title={IMPORT_BUTTON_LABEL}
              onChange={handleImportChange}
            />
          </>
        )}
      </div>
    </section>
  );
}
