import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from '@tau/desktop';

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' };

/** Closed triggers — the state a Select spends nearly all its life in. */
export function Triggers() {
  return (
    <div style={row}>
      <Select defaultValue="tran">
        <SelectTrigger>
          <SelectValue placeholder="Analysis" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tran">Transient</SelectItem>
          <SelectItem value="ac">AC sweep</SelectItem>
          <SelectItem value="dc">DC sweep</SelectItem>
        </SelectContent>
      </Select>

      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick a node…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="vout">V(out)</SelectItem>
          <SelectItem value="vin">V(in)</SelectItem>
        </SelectContent>
      </Select>

      <Select disabled defaultValue="tran">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tran">Transient</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={row}>
      <Select defaultValue="gear">
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="gear">Gear</SelectItem>
        </SelectContent>
      </Select>
      <Select defaultValue="gear">
        <SelectTrigger size="default">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="gear">Gear</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/** Open listbox with grouped items — how the menu reads when expanded. */
export function OpenMenu() {
  return (
    <Select defaultValue="vout" defaultOpen>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Voltages</SelectLabel>
          <SelectItem value="vout">V(out)</SelectItem>
          <SelectItem value="vin">V(in)</SelectItem>
          <SelectItem value="vmid">V(mid)</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Currents</SelectLabel>
          <SelectItem value="ir1">I(R1)</SelectItem>
          <SelectItem value="ic1">I(C1)</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
