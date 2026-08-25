/** Geometry shared by independent-source artwork and its clearance tests. */

export interface SourcePoint {
  x: number;
  y: number;
}

export interface SourceSegment {
  a: SourcePoint;
  b: SourcePoint;
}

/** The voltage pulse is offset left so its top step cannot cross the + mark. */
export const SOURCE_VOLTAGE_PULSE_SEGMENTS: readonly SourceSegment[] = [
  { a: { x: -10, y: 5 }, b: { x: -10, y: -5 } },
  { a: { x: -10, y: -5 }, b: { x: -8, y: -5 } },
  { a: { x: -8, y: -5 }, b: { x: -8, y: 5 } },
  { a: { x: -8, y: 5 }, b: { x: -4, y: 5 } },
  { a: { x: -4, y: 5 }, b: { x: -4, y: -5 } },
  { a: { x: -4, y: -5 }, b: { x: -1, y: -5 } },
];

/** Current pulse remains centred; its arrow is moved down to y = 0. */
export const SOURCE_CURRENT_PULSE_SEGMENTS: readonly SourceSegment[] = [
  { a: { x: -7, y: -4 }, b: { x: -7, y: -9 } },
  { a: { x: -7, y: -9 }, b: { x: -2, y: -9 } },
  { a: { x: -2, y: -9 }, b: { x: -2, y: -4 } },
  { a: { x: -2, y: -4 }, b: { x: 2, y: -4 } },
  { a: { x: 2, y: -4 }, b: { x: 2, y: -9 } },
  { a: { x: 2, y: -9 }, b: { x: 7, y: -9 } },
];

export const SOURCE_CURRENT_ARROW_SEGMENTS: readonly SourceSegment[] = [
  { a: { x: 0, y: 0 }, b: { x: 0, y: 8 } },
  { a: { x: -5, y: 4 }, b: { x: 0, y: 10 } },
  { a: { x: 0, y: 10 }, b: { x: 5, y: 4 } },
];

export function sourcePolaritySegments(side = 0): {
  positive: readonly SourceSegment[];
  negative: readonly SourceSegment[];
} {
  return {
    positive: [
      { a: { x: side - 4, y: -7 }, b: { x: side + 4, y: -7 } },
      { a: { x: side, y: -11 }, b: { x: side, y: -3 } },
    ],
    negative: [{ a: { x: side - 4, y: 8 }, b: { x: side + 4, y: 8 } }],
  };
}

export function sourceSegmentsPath(segments: readonly SourceSegment[]): string {
  const first = segments[0];
  if (!first) return "";
  const commands = [`M ${first.a.x} ${first.a.y}`];
  let previous = first;
  for (const segment of segments) {
    if (segment !== first && (segment.a.x !== previous.b.x || segment.a.y !== previous.b.y)) {
      commands.push(`M ${segment.a.x} ${segment.a.y}`);
    }
    commands.push(`L ${segment.b.x} ${segment.b.y}`);
    previous = segment;
  }
  return commands.join(" ");
}

/**
 * Clearance from a closed circular body to a painted segment. The farthest
 * point of a straight segment from the origin is one of its endpoints, so the
 * endpoint maximum is the exact segment-to-circle clearance rather than an
 * endpoint-only approximation.
 */
export function sourceSegmentCircleClearance(
  segment: SourceSegment,
  radius: number,
  strokeExpansion = 0,
): number {
  return radius - Math.max(Math.hypot(segment.a.x, segment.a.y), Math.hypot(segment.b.x, segment.b.y)) - strokeExpansion;
}

function cross(a: SourcePoint, b: SourcePoint, c: SourcePoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function within(value: number, a: number, b: number): boolean {
  return value >= Math.min(a, b) - 1e-9 && value <= Math.max(a, b) + 1e-9;
}

function segmentsIntersect(a: SourceSegment, b: SourceSegment): boolean {
  const c1 = cross(a.a, a.b, b.a);
  const c2 = cross(a.a, a.b, b.b);
  const c3 = cross(b.a, b.b, a.a);
  const c4 = cross(b.a, b.b, a.b);
  if ((c1 > 0 && c2 < 0 || c1 < 0 && c2 > 0) && (c3 > 0 && c4 < 0 || c3 < 0 && c4 > 0)) return true;
  return Math.abs(c1) < 1e-9 && within(b.a.x, a.a.x, a.b.x) && within(b.a.y, a.a.y, a.b.y)
    || Math.abs(c2) < 1e-9 && within(b.b.x, a.a.x, a.b.x) && within(b.b.y, a.a.y, a.b.y)
    || Math.abs(c3) < 1e-9 && within(a.a.x, b.a.x, b.b.x) && within(a.a.y, b.a.y, b.b.y)
    || Math.abs(c4) < 1e-9 && within(a.b.x, b.a.x, b.b.x) && within(a.b.y, b.a.y, b.b.y);
}

function pointSegmentDistance(point: SourcePoint, segment: SourceSegment): number {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - segment.a.x, point.y - segment.a.y);
  const t = Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (segment.a.x + t * dx), point.y - (segment.a.y + t * dy));
}

/** Centerline clearance between two open strokes, before stroke expansion. */
export function sourceSegmentClearance(a: SourceSegment, b: SourceSegment): number {
  if (segmentsIntersect(a, b)) return 0;
  return Math.min(
    pointSegmentDistance(a.a, b),
    pointSegmentDistance(a.b, b),
    pointSegmentDistance(b.a, a),
    pointSegmentDistance(b.b, a),
  );
}

export function sourceGroupClearance(a: readonly SourceSegment[], b: readonly SourceSegment[]): number {
  return Math.min(...a.flatMap((left) => b.map((right) => sourceSegmentClearance(left, right))));
}
