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
  externalEditDialogBody,
  externalEditDialogTitle,
  type ExternalEditKind,
} from "../lib/externalEditConflict";

export type PendingExternalEdit = {
  tabId: string;
  filePath: string;
  title: string;
  kind: Exclude<ExternalEditKind, "in-sync">;
  /** Raw disk bytes when still present (for Reload). */
  diskText: string | null;
  diskFingerprint: string | null;
};

/**
 * Offered when a disk-backed tab's file changed (or vanished) outside Tau.
 * Reload takes disk; Keep mine / Keep open acknowledges without silently
 * overwriting; Discard (missing only) closes the detached path choice by
 * letting the parent drop the file binding.
 */
export function ExternalEditConflictDialog({
  pending,
  onReload,
  onKeep,
  onDiscard,
}: {
  pending: PendingExternalEdit;
  onReload: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const canReload = pending.kind !== "missing" && pending.diskText !== null;
  const keepLabel = pending.kind === "missing" ? "Keep open" : "Keep mine";

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onKeep(); }}>
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
          <DialogTitle>{externalEditDialogTitle(pending.kind)}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="confirm-dialog-body">
          {externalEditDialogBody(pending.kind, pending.title)}
        </DialogDescription>
        <DialogFooter className="confirm-actions">
          {pending.kind === "missing" && (
            <Button variant="outline" onClick={onDiscard}>
              Discard
            </Button>
          )}
          <Button
            data-autofocus={!canReload}
            variant="outline"
            onClick={onKeep}
          >
            {keepLabel}
          </Button>
          {canReload && (
            <Button data-autofocus onClick={onReload}>
              Reload
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
