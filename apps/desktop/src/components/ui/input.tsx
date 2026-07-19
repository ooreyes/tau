import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * shadcn Input (new-york), adapted to Tau: see button.tsx
 * for the shared rationale (Tau tokens only, self-contained UA resets, dense
 * sizing). `variant="mono"` opts into `.mono-num` (App.css) for numeric
 * fields (component values, node voltages, etc.) - tabular figures so digits
 * don't jitter the field width as they change.
 */
const inputVariants = cva(
  "flex w-full min-w-0 appearance-none rounded-md border border-border bg-background text-xs text-foreground [font-family:inherit] outline-none transition-colors placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground hover:border-border-strong focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30",
  {
    variants: {
      variant: {
        default: "",
        mono: "mono-num",
      },
      size: {
        sm: "h-7 px-2.5",
        default: "h-8 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  },
);

function Input({
  className,
  variant,
  size,
  type = "text",
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>) {
  // `size` is a real HTML input attribute (a number, the visible character
  // width) that collides with cva's own `size` density variant (a string) -
  // `Omit` above drops the native one so callers can pass `size="sm"`.
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Input, inputVariants };
