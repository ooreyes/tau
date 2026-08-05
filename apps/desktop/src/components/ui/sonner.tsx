import { Toaster as Sonner, type ToasterProps } from "sonner";

import { cn } from "@/lib/utils";

/**
 * shadcn Sonner toast host, adapted to Tau: panel-2 surface, accent hairline,
 * cream label — same recipe as the legacy `.shell-toast` so notices keep the
 * instrument look without ad-hoc markup in App.tsx.
 *
 * Colors come from Tau CSS variables (not Sonner's stock light/dark palettes),
 * so the host theme prop is only a Sonner API requirement — fixed to `dark`
 * to avoid matchMedia/`system` in jsdom and because toast chrome is token-driven.
 */
function Toaster({ className, theme = "dark", ...props }: ToasterProps) {
  return (
    <Sonner
      data-slot="toaster"
      theme={theme}
      className={cn("toaster group", className)}
      toastOptions={{
        classNames: {
          toast: cn(
            "group toast group-[.toaster]:border group-[.toaster]:border-[var(--accent-line)]",
            "group-[.toaster]:bg-[var(--panel-2)] group-[.toaster]:text-[var(--cream)]",
            "group-[.toaster]:shadow-[var(--elev-pop)] group-[.toaster]:rounded-[var(--r-lg)]",
            "group-[.toaster]:font-[600_var(--fs-label)_var(--font-ui)]",
          ),
          description: "group-[.toast]:text-[var(--muted)]",
        },
      }}
      position="bottom-right"
      {...props}
    />
  );
}

export { Toaster };
export { toast } from "sonner";
