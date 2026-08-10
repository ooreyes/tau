import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@tau/desktop';

/** The palette in its modal shell — ⌘K in the app. */
export function Open() {
  return (
    <CommandDialog open title="Command palette" description="Search commands and components">
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Analysis">
          <CommandItem>
            Run transient
            <CommandShortcut>⌘R</CommandShortcut>
          </CommandItem>
          <CommandItem>
            Run AC sweep
            <CommandShortcut>⇧⌘A</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Schematic">
          <CommandItem>
            Place resistor
            <CommandShortcut>R</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
