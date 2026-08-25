/** Versioned first-use guidance for Tau's project-sheet interface. */
export const HIERARCHY_GUIDANCE_KIND = "tau.hierarchy.guidance.v1" as const;
export const HIERARCHY_GUIDANCE_KEY = HIERARCHY_GUIDANCE_KIND;

export interface HierarchyGuidanceState {
  kind: typeof HIERARCHY_GUIDANCE_KIND;
  completed: boolean;
}

export const DEFAULT_HIERARCHY_GUIDANCE_STATE: HierarchyGuidanceState = {
  kind: HIERARCHY_GUIDANCE_KIND,
  completed: false,
};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readHierarchyGuidanceState(): HierarchyGuidanceState {
  const raw = storage()?.getItem(HIERARCHY_GUIDANCE_KEY);
  if (!raw) return { ...DEFAULT_HIERARCHY_GUIDANCE_STATE };
  try {
    const value = JSON.parse(raw) as Partial<HierarchyGuidanceState>;
    if (value.kind !== HIERARCHY_GUIDANCE_KIND || typeof value.completed !== "boolean") {
      return { ...DEFAULT_HIERARCHY_GUIDANCE_STATE };
    }
    return { kind: HIERARCHY_GUIDANCE_KIND, completed: value.completed };
  } catch {
    return { ...DEFAULT_HIERARCHY_GUIDANCE_STATE };
  }
}

export function completeHierarchyGuidance(): void {
  try {
    storage()?.setItem(HIERARCHY_GUIDANCE_KEY, JSON.stringify({
      kind: HIERARCHY_GUIDANCE_KIND,
      completed: true,
    } satisfies HierarchyGuidanceState));
  } catch {
    // Preferences are convenience state. A storage-hostile environment simply
    // shows the guide again, which is safer than claiming it was completed.
  }
}

export function resetHierarchyGuidance(): void {
  try {
    storage()?.removeItem(HIERARCHY_GUIDANCE_KEY);
  } catch {
    // Private browsing and quota shims are intentionally fail-open.
  }
}
