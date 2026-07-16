import { TauriMascot } from "./TauriMascot";
import { FolderOpen, FolderPlus, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({
  projectOpen = true,
  canCreateProject = false,
  onOpenFolder,
  onCreateProject,
  onNewCircuit,
  onAskTauri,
}: {
  projectOpen?: boolean;
  canCreateProject?: boolean;
  onOpenFolder?: () => void;
  onCreateProject?: () => void;
  onNewCircuit?: () => void;
  onAskTauri?: () => void;
}) {
  return (
    <section className="empty-state" aria-label="Empty schematic">
      <div className="empty-panel">
        <div className="empty-kicker">
          <TauriMascot className="tauri-empty-mascot" aria-hidden="true" />
          Meet Tauri
        </div>
        <h1>{projectOpen ? "Create or open a schematic" : "Open a project folder"}</h1>
        {projectOpen ? (
          <>
            <p>
              Every schematic is saved inside this project. Create a circuit,
              open one from Explorer, or ask Tauri to design it with you.
            </p>
            <div className="empty-state-actions">
              <Button type="button" size="sm" onClick={onNewCircuit}>
                <Plus aria-hidden="true" /> New schematic
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onAskTauri}>
                <Sparkles aria-hidden="true" /> Ask Tauri
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>
              Like VS Code, Tau works inside a folder. Open an existing
              project or create one before viewing, editing, or generating schematics.
            </p>
            <div className="empty-state-actions">
              <Button type="button" size="sm" onClick={onOpenFolder}>
                <FolderOpen aria-hidden="true" /> Open folder
              </Button>
              {canCreateProject && (
                <Button type="button" size="sm" variant="outline" onClick={onCreateProject}>
                  <FolderPlus aria-hidden="true" /> Create project
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
