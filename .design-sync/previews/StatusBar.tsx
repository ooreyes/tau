import { StatusBar } from '@tau/desktop';

/** One line of state at the bottom of the window. */
export function SchematicMode() {
  return <StatusBar mode="schematic" result={null} title="low-pass-filter.asc" />;
}

export function SimulatorMode() {
  return <StatusBar mode="simulator" result={null} title="buck-converter.asc" />;
}
