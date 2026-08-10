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
 * Dialogs render open here so the card shows the real surface — in the app the
 * open state is driven by `open` / `onOpenChange` from a trigger.
 */
export function SaveSchematic() {
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

export function Destructive() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this sweep?</DialogTitle>
          <DialogDescription>
            The stored results for “AC 10 Hz – 1 MHz” will be discarded. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Delete sweep</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
