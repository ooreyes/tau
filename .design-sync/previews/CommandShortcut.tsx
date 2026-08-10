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

/**
 * CommandShortcut renders inside the command list, so the preview is the palette.
 */
export function InThePalette() {
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
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Schematic">
            <CommandItem>
              Place resistor
              <CommandShortcut>R</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}
