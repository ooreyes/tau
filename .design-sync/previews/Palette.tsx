import { Palette } from '@tau/desktop';

/** The component palette: searchable parts list with a live symbol preview. */
export function Parts() {
  return (
    <div style={{ height: 520, display: 'flex' }}>
      <Palette focusSignal={0} onNotice={() => {}} />
    </div>
  );
}
