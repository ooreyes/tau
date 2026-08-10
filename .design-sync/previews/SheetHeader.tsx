import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@tau/desktop';

/**
 * SheetHeader is a layout slot inside SheetContent — no size of its own outside
 * one, so the preview is the whole sheet.
 */
export function InASheet() {
  return (
    <Sheet open>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Model libraries</SheetTitle>
          <SheetDescription>
            Directories searched for .lib and .sub files when a device model is not found.
          </SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
