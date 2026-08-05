import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatRecoveryAge,
  type UnsavedRecoverySnapshot,
} from "../lib/unsavedRecovery";

/**
 * Offered once at launch when a dirty crash-recovery snapshot (or a migrated
 * legacy autosave) is present. Restore loads the schematic; Discard clears it.
 */
export function UnsavedRecoveryDialog({
  snapshot,
  onRestore,
  onDiscard,
}: {
  snapshot: UnsavedRecoverySnapshot;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const where = snapshot.filePath
    ? `“${snapshot.title}”`
    : `unsaved schematic “${snapshot.title}”`;
  const age = formatRecoveryAge(snapshot.savedAt);

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onDiscard(); }}>
      <DialogContent
        role="alertdialog"
        className="confirm-dialog"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement)
            .querySelector<HTMLButtonElement>("[data-autofocus]")
            ?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Restore unsaved work?</DialogTitle>
        </DialogHeader>
        <DialogDescription className="confirm-dialog-body">
          Tau found unsaved edits to {where} from {age}. Restoring puts them
          back in the editor; discarding permanently clears the local recovery
          copy.
        </DialogDescription>
        <DialogFooter className="confirm-actions">
          <Button data-autofocus variant="outline" onClick={onDiscard}>
            Discard
          </Button>
          <Button onClick={onRestore}>Restore</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
