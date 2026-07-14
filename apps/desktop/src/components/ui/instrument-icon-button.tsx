import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type InstrumentIconButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "aria-label" | "aria-pressed" | "children" | "size"
> & {
  /** Short action name used by assistive technology and as the fallback tooltip. */
  label: string;
  /** A Lucide icon chosen for its equivalent SF Symbol action semantics. */
  icon: LucideIcon;
  /** Optional richer help text when the action needs interaction guidance. */
  tooltip?: React.ReactNode;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
  /** Supply only for toggle controls; momentary actions should leave this undefined. */
  pressed?: boolean;
};

/**
 * Dense instrument action used by plot, schematic, and measurement chrome.
 *
 * The 28×28 target, 16 px / 1.6-stroke icon, semantic tooltip, and complete
 * interaction states are fixed here so engineering control rows do not drift
 * into a mixture of text glyphs and one-off button treatments.
 */
const InstrumentIconButton = React.forwardRef<HTMLButtonElement, InstrumentIconButtonProps>(
  (
    {
      className,
      disabled,
      icon: Icon,
      label,
      pressed,
      tooltip,
      tooltipSide = "top",
      type = "button",
      ...props
    },
    ref,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          type={type}
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          className={cn(
            "rounded-sm border border-transparent text-muted-foreground",
            "hover:border-border-strong hover:bg-accent hover:text-foreground",
            "active:border-primary/50 active:bg-primary/15 active:text-primary",
            "aria-pressed:border-primary/50 aria-pressed:bg-primary/15 aria-pressed:text-primary",
            "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40",
            className,
          )}
          {...props}
        >
          <Icon aria-hidden="true" focusable="false" size={16} strokeWidth={1.6} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  ),
);

InstrumentIconButton.displayName = "InstrumentIconButton";

export { InstrumentIconButton, type InstrumentIconButtonProps };
