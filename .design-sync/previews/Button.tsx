import { Button } from '@tau/desktop';
import { Play, Trash2 } from 'lucide-react';

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };

export function Variants() {
  return (
    <div style={row}>
      <Button>Run</Button>
      <Button variant="secondary">Stop</Button>
      <Button variant="outline">Edit netlist</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">Delete sweep</Button>
      <Button variant="link">Open in LTspice</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={row}>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="icon" aria-label="Run">
        <Play size={16} strokeWidth={1.6} />
      </Button>
      <Button size="icon-sm" variant="outline" aria-label="Delete">
        <Trash2 size={16} strokeWidth={1.6} />
      </Button>
    </div>
  );
}

export function WithIcon() {
  return (
    <div style={row}>
      <Button>
        <Play size={16} strokeWidth={1.6} />
        Run transient
      </Button>
      <Button variant="outline">
        <Trash2 size={16} strokeWidth={1.6} />
        Clear results
      </Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={row}>
      <Button disabled>Run</Button>
      <Button variant="secondary" disabled>
        Stop
      </Button>
      <Button variant="outline" disabled>
        Edit netlist
      </Button>
      <Button variant="destructive" disabled>
        Delete sweep
      </Button>
    </div>
  );
}
