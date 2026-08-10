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

/**
 * SelectSeparator only renders inside an open Select listbox, so the preview opens one.
 */
export function InAnOpenListbox() {
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
