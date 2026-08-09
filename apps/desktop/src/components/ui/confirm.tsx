/**
 * The two destructive-action dialogs, moved out of ShellPanels.tsx.
 *
 * They are `ui/` rather than `shell/` because nothing about them is shell:
 * they are generic confirmations that any surface can raise, and the
 * canvas-first redesign moves every actual shell panel out from under them.
 *
 * Both focus Cancel rather than the destructive button on open, so a stray
 * Enter cannot fire the action. Radix would otherwise focus the content
 * itself, which is why each one intercepts `onOpenAutoFocus`.
 */
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent
        role="alertdialog"
        className="confirm-dialog"
        // Focus Cancel, not Confirm, on open so a stray Enter can't fire the
        // destructive action - Radix otherwise focuses the content itself.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>("[data-autofocus]")?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="confirm-dialog-body">{body}</DialogDescription>
        <DialogFooter className="confirm-actions">
          <Button data-autofocus variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UnsavedChangesDialog({
  title,
  saving = false,
  onSave,
  onDiscard,
  onCancel,
}: {
  title: string;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => { if (!next && !saving) onCancel(); }}>
      <DialogContent
        role="alertdialog"
        className="confirm-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>("[data-autofocus]")?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Save changes to “{title}”?</DialogTitle>
        </DialogHeader>
        <DialogDescription className="confirm-dialog-body">
          Your changes will be lost if you close this schematic without saving.
        </DialogDescription>
        <DialogFooter className="confirm-actions">
          <Button data-autofocus variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" disabled={saving} onClick={onDiscard}>Don’t Save</Button>
          <Button disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
