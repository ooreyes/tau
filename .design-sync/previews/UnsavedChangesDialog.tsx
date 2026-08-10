import { UnsavedChangesDialog } from '@tau/desktop';

const noop = () => {};

export function Prompt() {
  return (
    <UnsavedChangesDialog title="low-pass-filter.asc" onSave={noop} onDiscard={noop} onCancel={noop} />
  );
}

export function Saving() {
  return (
    <UnsavedChangesDialog title="low-pass-filter.asc" saving onSave={noop} onDiscard={noop} onCancel={noop} />
  );
}
