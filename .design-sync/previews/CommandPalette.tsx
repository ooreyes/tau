import { CommandPalette } from '@tau/desktop';

/** ⌘K — the palette over the workspace. */
export function Open() {
  return <CommandPalette open onClose={() => {}} />;
}
