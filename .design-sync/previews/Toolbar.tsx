import { Toolbar } from '@tau/desktop';

const noop = () => {};

const props = {
  onModeChange: noop,
  onRun: noop,
  onToggleAssistant: noop,
  onOpenSettings: noop,
};

/** The window's top chrome at rest. */
export function Idle() {
  return (
    <Toolbar
      mode="schematic"
      result={null}
      runState="idle"
      isRunning={false}
      title="low-pass-filter.asc"
      assistantOpen={false}
      {...props}
    />
  );
}

/** Transport lamp while the solver is working. */
export function Running() {
  return (
    <Toolbar
      mode="simulator"
      result={null}
      runState="idle"
      isRunning
      title="buck-converter.asc"
      assistantOpen
      {...props}
    />
  );
}

/** A failed run — the lamp is the only saturated colour in the chrome. */
export function Error() {
  return (
    <Toolbar
      mode="simulator"
      result={null}
      runState="error"
      isRunning={false}
      title="buck-converter.asc"
      assistantOpen={false}
      {...props}
    />
  );
}
