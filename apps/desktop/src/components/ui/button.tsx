import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * shadcn Button (new-york), adapted to Tau:
 * - All color routes through the Tau token layer (`src/styles/tokens.css`),
 *   so buttons re-theme with the runtime theme switcher for free.
 * - The base string carries its own UA resets (`appearance-none`, explicit
 *   border, `[font-family:inherit]`): preflight is deliberately NOT imported
 *   (see tokens.css), so a primitive must not rely on its resets.
 * - Sizes run dense (sm = 28px row height) per the density rule:
 *   LTspice users must not feel the UI wastes their pixels.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer select-none appearance-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-xs font-medium [font-family:inherit] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        outline: "border-border bg-transparent text-foreground hover:bg-accent",
        ghost: "bg-transparent text-foreground hover:bg-accent",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        link: "bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5",
        default: "h-8 px-3",
        lg: "h-9 px-4",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
