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

/**
 * DropdownMenuRadioGroup only renders inside an open DropdownMenu, so the preview is the
 * whole menu — that is the only render of this part that is ever true.
 */
export function InAnOpenMenu() {
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
