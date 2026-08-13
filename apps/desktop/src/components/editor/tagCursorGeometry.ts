/**
 * Shared geometry for the browser tag cursor and Canvas's snapped SVG preview.
 * This stays independent of the schematic geometry module so the small editor
 * glyph does not pull the canvas/netlisting dependency graph into the toolbar.
 */
export interface TagCursorPoint {
  x: number;
  y: number;
}

export const TAG_CURSOR_ART = {
  width: 32,
  height: 32,
  hotspot: { x: 3, y: 16 },
} as const;

export const TAG_CURSOR_BODY_PATH = `M${TAG_CURSOR_ART.hotspot.x} ${TAG_CURSOR_ART.hotspot.y} L11 7 H26 A3 3 0 0 1 29 10 V22 A3 3 0 0 1 26 25 H11 Z`;
export const TAG_CURSOR_EYELET = { cx: 11, cy: 16, r: 2.35 } as const;

export interface TagCursorPreviewGeometry {
  /** World-space upper-left of the fixed-pixel tag art. */
  x: number;
  y: number;
  /** Inverse canvas zoom; outer canvas zoom therefore leaves the art 32 CSS px. */
  scale: number;
}

/**
 * Place fixed-pixel tag artwork so its pointed short end lands exactly on the
 * snapped world anchor. SVG applies the outer canvas zoom after this transform,
 * so the inverse scale keeps both the art size and its attachment point stable
 * in CSS pixels at every supported zoom.
 */
export function tagCursorPreviewGeometry(anchor: TagCursorPoint, zoom: number): TagCursorPreviewGeometry {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const scale = 1 / safeZoom;
  return {
    x: anchor.x - TAG_CURSOR_ART.hotspot.x * scale,
    y: anchor.y - TAG_CURSOR_ART.hotspot.y * scale,
    scale,
  };
}

/** The world point occupied by the rendered tag's attachment tip. */
export function tagCursorPreviewAttachmentPoint(preview: TagCursorPreviewGeometry): TagCursorPoint {
  return {
    x: preview.x + TAG_CURSOR_ART.hotspot.x * preview.scale,
    y: preview.y + TAG_CURSOR_ART.hotspot.y * preview.scale,
  };
}
