import { ConfirmDialog } from '@tau/desktop';

const noop = () => {};

/**
 * Always open by construction — the caller mounts it to ask, unmounts on
 * answer. Cancel is focused, not the destructive action.
 */
export function DeleteSweep() {
  return (
    <ConfirmDialog
      title="Delete this sweep?"
      body="The stored results for “AC 10 Hz – 1 MHz” will be discarded. This cannot be undone."
      confirmLabel="Delete sweep"
      onConfirm={noop}
      onCancel={noop}
    />
  );
}
