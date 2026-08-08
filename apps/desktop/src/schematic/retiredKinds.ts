/**
 * Component kinds Tau used to place and has since removed.
 *
 * A saved document outlives the palette. Both load paths - a `.sim` and an
 * `.asc` written under a carrier symbol - can still name a kind that no longer
 * exists, and neither may resolve it to something plausible: the `.asc` carrier
 * for a marker is a 1 T resistor, so honoring it would turn an annotation into
 * a real part. Every retired kind is dropped on load and reported by name.
 *
 * Retiring a kind means adding a row here, not just deleting the enum member.
 */
export const RETIRED_KIND_NOTICES: ReadonlyMap<string, string> = new Map([
  ["testpoint", "Test Point was removed; probe the node instead. The marker was dropped."],
]);

export function isRetiredKind(kind: string): boolean {
  return RETIRED_KIND_NOTICES.has(kind);
}

/** Notice for one dropped instance, named so the user can find what changed. */
export function retiredKindNotice(kind: string, label: string): string | null {
  const reason = RETIRED_KIND_NOTICES.get(kind);
  return reason ? `${label || kind}: ${reason}` : null;
}
