import { Tooltip, TooltipTrigger, TooltipContent, Button } from '@tau/desktop';

/**
 * Tooltips are instrument labels, not call-outs. `defaultOpen` is what makes
 * the surface visible in a static card — in the app it opens on hover.
 */
export function Open() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 56 }}>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="outline">Fit to data</Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Scale both axes to the visible trace extents</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function Sides() {
  return (
    <div style={{ display: 'flex', gap: 48, justifyContent: 'center', padding: '56px 0' }}>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="ghost">Top</Button>
        </TooltipTrigger>
        <TooltipContent side="top">Runs the active analysis</TooltipContent>
      </Tooltip>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="ghost">Bottom</Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Clears every stored result</TooltipContent>
      </Tooltip>
    </div>
  );
}
