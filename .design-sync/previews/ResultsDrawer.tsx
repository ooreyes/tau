import { ResultsDrawer } from '@tau/desktop';

const pane = (text: string) => (
  <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>{text}</div>
);

/** A finished run, waveforms tab forward. */
export function Complete() {
  return (
    <div style={{ position: 'relative', height: 420 }}>
      <ResultsDrawer
        status="complete"
        statusLine="20 ms · 2001 samples"
        preferredTab="waveforms"
        preferredHeight="half"
        waveforms={pane('4 traces — V(out), V(in), I(R1), I(C1)')}
        measurements={pane('3 components measured')}
      />
    </div>
  );
}

/** Mid-run: Stop is reachable from the results, not just the toolbar. */
export function Running() {
  return (
    <div style={{ position: 'relative', height: 420 }}>
      <ResultsDrawer
        status="running"
        statusLine="transient · 8.4 ms elapsed"
        onStop={() => {}}
        preferredHeight="peek"
        waveforms={pane('Solving…')}
      />
    </div>
  );
}

/** A failed run, errors tab forward with the badge. */
export function Failed() {
  return (
    <div style={{ position: 'relative', height: 420 }}>
      <ResultsDrawer
        status="error"
        statusLine="stopped at t = 4.19 ms"
        preferredTab="errors"
        preferredHeight="half"
        errorBadge={{ text: '1 error', tone: 'error' }}
        errors={pane('Timestep too small; convergence failed at t = 4.19 ms.')}
      />
    </div>
  );
}
