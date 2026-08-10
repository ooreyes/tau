import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  Button,
} from '@tau/desktop';

/** The open menu — every part of the family in one true composition. */
export function OpenMenu() {
  return (
    <div style={{ paddingBottom: 260 }}>
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Trace…</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Trace</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem>
              Add to plot
              <DropdownMenuShortcut>⏎</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Export CSV…
              <DropdownMenuShortcut>⇧⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked>Show markers</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem>Log Y axis</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Units</DropdownMenuLabel>
          <DropdownMenuRadioGroup value="db">
            <DropdownMenuRadioItem value="db">Decibels</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="lin">Linear</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Closed trigger — how the control reads at rest. */
export function Trigger() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Trace…</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Add to plot</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
