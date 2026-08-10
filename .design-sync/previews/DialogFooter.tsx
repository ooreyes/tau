import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
} from '@tau/desktop';

/**
 * DialogFooter is a layout slot inside DialogContent — it has no size or styling of
 * its own outside one, so the preview is the whole dialog.
 */
export function InADialog() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save schematic</DialogTitle>
          <DialogDescription>
            The netlist is written alongside the .asc file so LTspice can open it unchanged.
          </DialogDescription>
        </DialogHeader>
        <Input defaultValue="low-pass-filter.asc" />
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
