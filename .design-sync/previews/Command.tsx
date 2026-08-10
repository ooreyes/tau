import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from '@tau/desktop';

/** The command palette's inner surface: input, grouped results, shortcuts. */
export function Palette() {
  return (
    <div style={{ width: 420 }}>
      <Command>
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
            <CommandItem>Edit simulation command…</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Schematic">
            <CommandItem>
              Place resistor
              <CommandShortcut>R</CommandShortcut>
            </CommandItem>
            <CommandItem>
              Place capacitor
              <CommandShortcut>C</CommandShortcut>
            </CommandItem>
            <CommandItem>
              Draw wire
              <CommandShortcut>W</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

/** The empty state, which is a real surface users hit constantly. */
export function NoResults() {
  return (
    <div style={{ width: 420 }}>
      <Command>
        <CommandInput placeholder="Type a command or search…" value="qqq" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
        </CommandList>
      </Command>
    </div>
  );
}
