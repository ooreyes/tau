import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

/**
 * shadcn Tabs (new-york), adapted to Tau (§10 design system). Dense row
 * height (`--row-h` = 28px) for the trigger strip; active trigger reads as a
 * flat cobalt-accent tab (no stock shadcn `bg-background` pill — the tokens
 * bridge doesn't define one that reads correctly on true black). Self
 * -contained UA resets on the trigger (button semantics, no preflight).
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-[var(--row-h)] w-fit shrink-0 items-center gap-0.5 rounded-md border border-border bg-secondary p-0.5",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-full flex-1 shrink-0 cursor-pointer appearance-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[calc(var(--radius-md)-2px)] border border-transparent bg-transparent px-2.5 text-xs font-medium text-muted-foreground [font-family:inherit] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        "hover:text-foreground",
        "data-[state=active]:bg-primary data-[state=active]:text-primary-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
