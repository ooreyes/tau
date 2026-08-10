import { BottomPanel } from '@tau/desktop';

/** Diagnostics with nothing to report. */
export function Clean() {
  return <BottomPanel mode="schematic" result={null as never} />;
}

/** Document-level warnings raised by an ASC import, independent of any run. */
export function WithNotices() {
  return (
    <BottomPanel
      mode="schematic"
      result={null as never}
      notices={[
        'R3: value “1Meg5” is not a SPICE number — imported as 1Meg.',
        'U1: no model found for LT1001 — falling back to a generic op-amp.',
      ]}
    />
  );
}

export function Running() {
  return <BottomPanel mode="simulator" result={null as never} isRunning />;
}
