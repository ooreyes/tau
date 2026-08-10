import * as React from 'react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@tau/desktop';

/**
 * Radix's ContextMenu has no controlled `open` prop — right-click is the only
 * way in. The preview fires a real `contextmenu` event on mount so the card
 * shows the actual open surface rather than an empty target area.
 */
function useAutoOpen() {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: r.left + 24,
        clientY: r.top + 16,
      }),
    );
  }, []);
  return ref;
}

const target: React.CSSProperties = {
  width: 260,
  height: 64,
  display: 'grid',
  placeItems: 'center',
  border: '1px dashed var(--border)',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--muted)',
};

export function OnCanvasSelection() {
  const ref = useAutoOpen();
  return (
    <div style={{ paddingBottom: 300 }}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div ref={ref} style={target}>
            R1 — right-click target
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>R1 · 10 kΩ</ContextMenuLabel>
          <ContextMenuGroup>
            <ContextMenuItem>
              Edit value…
              <ContextMenuShortcut>⏎</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              Rotate
              <ContextMenuShortcut>⌘R</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem>
              Delete
              <ContextMenuShortcut>⌫</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuCheckboxItem checked>Show current arrow</ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <ContextMenuLabel>Orientation</ContextMenuLabel>
          <ContextMenuRadioGroup value="h">
            <ContextMenuRadioItem value="h">Horizontal</ContextMenuRadioItem>
            <ContextMenuRadioItem value="v">Vertical</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
