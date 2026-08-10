import * as React from 'react';
import { Toaster, toast } from '@tau/desktop';

/**
 * The toast host renders nothing until something raises a toast.
 *
 * `toast` must come from the DS bundle, not from `'sonner'` directly: sonner's
 * toast store is module state, so a second copy bundled into the preview would
 * have its own store and never reach this `<Toaster>`. It reaches
 * `window.TauDS` because `cfg.extraEntries` merges `ui/sonner.tsx` into the
 * bundle namespace.
 *
 * `duration: Infinity` holds the toasts for the card; in the app they dismiss
 * after 3.2 s.
 */
export function Notices() {
  React.useEffect(() => {
    toast.success('Run complete', { description: '20 ms · 2001 samples', duration: Infinity });
    toast.error('Solver did not converge', {
      description: 'Timestep too small at t = 4.19 ms',
      duration: Infinity,
    });
    toast('Netlist copied to clipboard', { duration: Infinity });
  }, []);
  return (
    <div style={{ transform: 'translateZ(0)', position: 'relative', height: 300, width: 520 }}>
      {/* `expand` keeps the stack open so all three tones are visible at once. */}
      <Toaster expand visibleToasts={3} />
    </div>
  );
}
