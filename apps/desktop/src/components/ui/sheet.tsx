import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Sheet - a corner-anchored slide-in panel built on the same Radix
 * Dialog primitive as ui/dialog.tsx (focus trap, Escape-to-close, outside-
 * click all come free), positioned as an operator-console side panel instead
 * of a centered pop. This is the treatment Tau's Settings panel has always
 * used (top-right, not a full-height drawer) - now with real slide-from-edge
 * motion (`--animate-slide-in/out-right`, tokens.css) instead of Dialog's
 * scale-pop. Height is capped to the viewport (`max-h` + `overflow-y-auto`)
 * so dense Settings content stays reachable at the app's 900×600 minimum
 * window. Backdrop uses the lighter `--scrim` (a side sheet dims the console
 * less than a centered alert, which keeps `--scrim-strong` in ui/dialog.tsx).
 */
function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-[var(--scrim)]",
        "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  overlayClassName,
  children,
  showCloseButton = true,
  closeLabel = "Close",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  closeLabel?: string;
  /** Preserve a surface's established backdrop treatment when it is migrated from Dialog. */
  overlayClassName?: string;
}) {
  return (
    <SheetPortal>
      <SheetOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          // top-12 (48px) + 12px bottom inset → max-h keeps the sheet inside
          // the stated 900×600 minimum; overflow-y-auto is the reachability
          // path when Appearance + Circuit assistant + Workspace exceed it.
          "fixed top-12 right-3 z-50 flex max-h-[calc(100vh-60px)] w-[360px] max-w-[calc(100vw-24px)] flex-col gap-0 overflow-y-auto rounded-lg border border-border-strong bg-popover text-popover-foreground shadow-[var(--elev-pop)] outline-none",
          "data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="sheet-close"
            aria-label={closeLabel}
            className="absolute top-3 right-3 inline-flex size-7 shrink-0 cursor-pointer appearance-none items-center justify-center rounded-md border border-border-strong bg-transparent p-0 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-3.5" aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 border-b border-border px-4 py-3", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-sm font-semibold text-[var(--cream)] [font-family:inherit]", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-xs text-muted-foreground [font-family:inherit]", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetOverlay,
  SheetPortal,
};
