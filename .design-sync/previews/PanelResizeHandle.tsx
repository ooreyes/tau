import { PanelResizeHandle } from '@tau/desktop';

const noop = () => {};

const shell: React.CSSProperties = {
  position: 'relative',
  width: 260,
  height: 140,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--panel)',
  display: 'grid',
  placeItems: 'center',
  fontSize: 11,
  color: 'var(--muted)',
};

/**
 * The handle is a hairline that only reads in context, so each cell shows it
 * on the edge of a real panel.
 */
export function OnAPanelEdge() {
  return (
    <div style={shell}>
      Explorer
      <PanelResizeHandle
        edge="right"
        label="Resize explorer"
        width={260}
        minWidth={180}
        maxWidth={480}
        dragging={false}
        onPointerDown={noop}
        onKeyDown={noop}
      />
    </div>
  );
}

/** Mid-drag, when the handle takes the accent. */
export function Dragging() {
  return (
    <div style={shell}>
      Properties
      <PanelResizeHandle
        edge="left"
        label="Resize properties"
        width={260}
        minWidth={180}
        maxWidth={480}
        dragging
        onPointerDown={noop}
        onKeyDown={noop}
      />
    </div>
  );
}

/** A horizontal handle — same machinery driving a height. */
export function HorizontalEdge() {
  return (
    <div style={shell}>
      Telemetry dock
      <PanelResizeHandle
        edge="top"
        label="Resize telemetry dock"
        width={140}
        minWidth={80}
        maxWidth={320}
        dragging={false}
        onPointerDown={noop}
        onKeyDown={noop}
      />
    </div>
  );
}
