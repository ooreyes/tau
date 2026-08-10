import { SelectionInspector, SettingsRow, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@tau/desktop';

/**
 * The floating properties panel. It places itself against the selection's
 * bounding box inside the given viewport, so the preview supplies real
 * client-coordinate rects.
 */
export function ComponentProperties() {
  return (
    <div style={{ position: 'relative', height: 320, width: 560, border: '1px dashed var(--border)', borderRadius: 6 }}>
      <SelectionInspector
        title="R1 properties"
        anchor={{ minX: 80, minY: 90, maxX: 140, maxY: 130 }}
        viewport={{ minX: 0, minY: 0, maxX: 560, maxY: 320 }}
        onDismiss={() => {}}
      >
        <SettingsRow label="Reference" htmlFor="ref">
          <Input id="ref" defaultValue="R1" style={{ width: 96 }} />
        </SettingsRow>
        <SettingsRow label="Value" htmlFor="val">
          <Input id="val" variant="mono" defaultValue="10k" style={{ width: 96 }} />
        </SettingsRow>
        <SettingsRow label="Tolerance">
          <Select defaultValue="1">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 %</SelectItem>
              <SelectItem value="5">5 %</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SelectionInspector>
    </div>
  );
}
