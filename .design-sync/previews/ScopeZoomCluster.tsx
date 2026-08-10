import { ScopeZoomCluster } from '@tau/desktop';

const noop = () => {};

/** The plot's zoom stack — sits over the top-right of a waveform card. */
export function Cluster() {
  return <ScopeZoomCluster onZoomIn={noop} onZoomOut={noop} onFit={noop} />;
}

/** With the periodic-aware auto-frame action. */
export function WithAutoFrame() {
  return (
    <ScopeZoomCluster onZoomIn={noop} onZoomOut={noop} onFit={noop} onAutoFrame={noop} />
  );
}
