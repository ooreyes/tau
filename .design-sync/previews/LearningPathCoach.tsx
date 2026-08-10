import { LearningPathCoach } from '@tau/desktop';

const noop = () => {};

// ContextualHelpTip — `shortcuts` is required and is read unguarded.
const tip = {
  id: 'first-run',
  title: 'Run your first analysis',
  body: 'Place a source and a resistor, wire them up, then run. Tau writes the netlist and solves it locally with ngspice.',
  shortcuts: ['R — place resistor', 'W — draw wire', '⌘R — run'],
};

/**
 * `.learning-path-coach` is `position: fixed` (bottom-right of the window), so
 * in a card it escapes the cell entirely. A `transform` on the wrapper makes it
 * the containing block for fixed descendants, which pins the coach inside the
 * cell without touching the component.
 */
const wrap: React.CSSProperties = {
  transform: 'translateZ(0)',
  position: 'relative',
  width: 460,
  height: 190,
  border: '1px dashed var(--border)',
  borderRadius: 6,
};

export function Pending() {
  return (
    <div style={wrap}>
      <LearningPathCoach
        tip={tip as never}
        status="pending"
        onDismiss={noop}
        onPrimary={noop}
        primaryLabel="Show me"
      />
    </div>
  );
}

export function InProgress() {
  return (
    <div style={wrap}>
      <LearningPathCoach
        tip={tip as never}
        status="in_progress"
        onDismiss={noop}
        onPrimary={noop}
        primaryLabel="Continue"
      />
    </div>
  );
}

export function Completed() {
  return (
    <div style={wrap}>
      <LearningPathCoach tip={tip as never} status="completed" onDismiss={noop} />
    </div>
  );
}
