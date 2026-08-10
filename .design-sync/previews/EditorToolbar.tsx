import { EditorToolbar } from '@tau/desktop';

const noop = () => {};

const props = {
  onRun: noop,
  onStop: noop,
  onClearScratchpad: noop,
  onOpenModelLibraries: noop,
  onOpenSimulationSetup: noop,
};

export function Idle() {
  return <EditorToolbar mode="schematic" isRunning={false} modelLibraryCount={3} {...props} />;
}

/** Mid-run: Run swaps to Stop. */
export function Running() {
  return <EditorToolbar mode="schematic" isRunning modelLibraryCount={3} {...props} />;
}

export function SimulatorMode() {
  return <EditorToolbar mode="simulator" isRunning={false} modelLibraryCount={0} {...props} />;
}
