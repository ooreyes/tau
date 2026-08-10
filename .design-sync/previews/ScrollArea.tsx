import { ScrollArea, Separator } from '@tau/desktop';

const nodes = ['V(out)', 'V(in)', 'V(mid)', 'V(fb)', 'I(R1)', 'I(R2)', 'I(C1)', 'I(L1)', 'I(V1)', 'V(n001)', 'V(n002)', 'V(n003)'];

/** Constrained viewport with the Tau thumb — the trace list uses this. */
export function TraceList() {
  return (
    <ScrollArea style={{ height: 180, width: 240, border: '1px solid var(--border)', borderRadius: 6 }}>
      <div style={{ padding: 8 }}>
        {nodes.map((n, i) => (
          <div key={n}>
            <div style={{ fontSize: 12, padding: '6px 4px', color: 'var(--text)' }}>{n}</div>
            {i < nodes.length - 1 && <Separator />}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
