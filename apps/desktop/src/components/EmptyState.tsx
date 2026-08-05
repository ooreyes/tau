import { useRef, type ChangeEvent } from "react";
import { BodeMascot } from "./BodeMascot";
import { FolderOpen, FolderPlus, Import, MessageSquare, Plus, CircuitBoard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { importDroppedFile } from "../io/fileImport";
import { IMPORT_ACCEPT, IMPORT_BUTTON_LABEL } from "../io/importUi";

export function EmptyState({
  projectOpen = true,
  canCreateProject = false,
  onOpenFolder,
  onCreateProject,
  onNewCircuit,
  onAskBode,
  onOpenAscText,
  onNotice,
  offerFirstSuccess = false,
  onTryFirstSuccess,
}: {
  projectOpen?: boolean;
  canCreateProject?: boolean;
  onOpenFolder?: () => void;
  onCreateProject?: () => void;
  onNewCircuit?: () => void;
  onAskBode?: () => void;
  /** Opens an imported schematic once it has been written into the project -
   *  same contract `ExplorerPanel` uses, so App.tsx can pass one function to
   *  both. Only needed for the no-project Import action below. */
  onOpenAscText?: (path: string, title: string, text: string, extraWarnings?: string[]) => void | Promise<void>;
  onNotice?: (message: string) => void;
  /** First-success learning path CTA (product-gates slice). */
  offerFirstSuccess?: boolean;
  onTryFirstSuccess?: () => void;
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    // No project is open on this screen, so a schematic could not possibly be
    // open either - a dropped model-library file is refused, not attached.
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

  return (
    <section className="empty-state" aria-label="Empty schematic">
      <div className="empty-panel">
        <div className="empty-kicker">
          <BodeMascot className="bode-empty-mascot" aria-hidden="true" />
          {/* One flex item, not three: .empty-kicker gaps its children, so a
              bare text node after the brand would space the comma off it. */}
          <span><span className="empty-brand">Bode</span> · circuit assistant</span>
        </div>
        <h1>{projectOpen ? "Create or open a schematic" : "Open a project folder"}</h1>
        {projectOpen ? (
          <>
            <p>
              Schematics live in this project. Create one, open from Explorer,
              {offerFirstSuccess
                ? " try the RC Charging first-success example, or ask Bode about the circuit."
                : " or ask Bode about the circuit."}
            </p>
            <div className="empty-state-actions">
              {offerFirstSuccess && (
                <Button type="button" size="sm" onClick={onTryFirstSuccess}>
                  <CircuitBoard aria-hidden="true" /> Try RC Charging
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={offerFirstSuccess ? "outline" : "default"}
                onClick={onNewCircuit}
              >
                <Plus aria-hidden="true" /> New schematic
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onAskBode}>
                <MessageSquare aria-hidden="true" /> Ask Bode
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>
              Tau keeps every schematic inside a project folder. Open one to start,
              or import an existing schematic or SPICE netlist.
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
