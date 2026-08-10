import { EditorTabs } from '@tau/desktop';

const noop = () => {};

const tabs = [
  { id: 'a', title: 'low-pass-filter.asc' },
  { id: 'b', title: 'buck-converter.asc', dirty: true },
  { id: 'c', title: 'opamp-inverting.asc' },
];

const props = {
  onSelectTab: noop,
  onCloseTab: noop,
  onRenameTab: noop,
  onNewCircuit: noop,
  onHideSimulator: noop,
};

/** Open documents, one of them with unsaved changes. */
export function SchematicTabs() {
  return <EditorTabs tabs={tabs} activeId="a" mode="schematic" {...props} />;
}

/** In simulator mode the strip carries the hide-simulator affordance. */
export function SimulatorTabs() {
  return <EditorTabs tabs={tabs} activeId="b" mode="simulator" {...props} />;
}

export function SingleTab() {
  return <EditorTabs tabs={[tabs[0]]} activeId="a" mode="schematic" {...props} />;
}
