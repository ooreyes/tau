/**
 * Dev-only automation bridge.
 *
 * The visual-proof pipeline (`scripts/design-shot.mjs`) has to reach states
 * that normally sit behind a native folder picker: a project root has to exist
 * before a schematic can be imported, and neither the Tauri dialog nor the
 * Chrome File System Access picker can be driven from headless Chromium.
 * Rather than have the screenshot script reach into React internals (which
 * breaks on every render-tree change), the app hands it the same store actions
 * the UI itself calls.
 *
 * Guarded by `import.meta.env.DEV` at the single call site in main.tsx, so the
 * constant folds to `false` for a production build and this module is dropped
 * from the bundle entirely. Nothing here is reachable in a shipped app.
 */

import { useProject } from "../store/useProject";
import { useSchematic } from "../store/useSchematic";
import { DEFAULT_WORKSPACE_ID } from "../project/defaultWorkspace";

export interface TauDevBridge {
  /** Seed the in-memory workspace so a project root exists. */
  seedWorkspace: () => void;
  /**
   * Import LTspice `.asc` text through the real importer and open it.
   * Returns the created path, or null if the import was rejected.
   */
  importAscText: (name: string, text: string) => Promise<string | null>;
  /** Select the first open-schematic component with this reference designator. */
  selectComponent: (reference: string) => boolean;
  useProject: typeof useProject;
  /**
   * The document store itself.
   *
   * Exposed for the same reason `useProject` is: several proofs are about state
   * the DOM cannot show. Whether a dropped ground really landed at rotation 0,
   * whether Backspace removed the net label from the document or merely hid its
   * glyph, whether an inspector edit rewrote `kind` as well as `value` - those
   * are store facts, and a screenshot can only guess at them. Reading them here
   * keeps the proof honest without the capture script reaching into React
   * internals, which is exactly what this module exists to avoid.
   */
  useSchematic: typeof useSchematic;
}

declare global {
  interface Window {
    __TAU_DEV__?: TauDevBridge;
  }
}

export function installDevBridge(): void {
  if (typeof window === "undefined") return;

  window.__TAU_DEV__ = {
    seedWorkspace: () => {
      const store = useProject.getState();
      // ensureDefaultWorkspace bails unless capability is "none"; the pipeline
      // deletes showDirectoryPicker so that holds. Set capability explicitly
      // anyway so the bridge does not depend on probe ordering.
      useProject.setState({ capability: "none" });
      store.ensureDefaultWorkspace();
    },

    importAscText: async (name, text) => {
      const store = useProject.getState();
      const root = store.rootPath ?? DEFAULT_WORKSPACE_ID;
      // Go through importAscFile, not a direct workspaceFiles write, so the
      // screenshots exercise the shipping import path (size cap, decoding,
      // validation, warning collection) instead of a test-only shortcut.
      const file = new File([text], name, { type: "text/plain" });
      return store.importAscFile(root, file);
    },

    selectComponent: (reference) => {
      const store = useSchematic.getState();
      const component = store.components.find(
        (candidate) => candidate.label.toLowerCase() === reference.trim().toLowerCase(),
      );
      if (!component) return false;
      store.select(component.id);
      return true;
    },

    useProject,
    useSchematic,
  };
}
