import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  Button,
} from '@tau/desktop';

/** Side panel, rendered open so the card shows the real surface. */
export function OpenSheet() {
  return (
    <Sheet open>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Model libraries</SheetTitle>
          <SheetDescription>
            Directories searched for .lib and .sub files when a device model is not found in
            the schematic.
          </SheetDescription>
        </SheetHeader>
        <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
          ~/Documents/LTspiceXVII/lib/sub<br />
          ~/Documents/LTspiceXVII/lib/cmp<br />
          /Applications/LTspice.app/Contents/lib
        </div>
        <div style={{ padding: 16 }}>
          <Button variant="outline">Add directory…</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
