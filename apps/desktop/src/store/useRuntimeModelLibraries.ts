import { create } from "zustand";

import {
  discoverInstalledLtspiceLibrary,
  readInstalledLtspiceModel,
} from "../project/installedLtspiceLibrary";
import type { SchematicModelLibrary } from "./useSchematic";

const STANDARD_MODEL_FILES = new Set([
  "standard.dio",
  "standard.bjt",
  "standard.mos",
  "standard.jft",
]);

export function installedLtspiceStandardModelFiles<
  T extends { readonly name: string },
>(files: readonly T[]): T[] {
  return files.filter((file) => STANDARD_MODEL_FILES.has(file.name.toLowerCase()));
}

interface RuntimeModelLibraryState {
  installedLtspice: SchematicModelLibrary[];
  status: "idle" | "loading" | "ready" | "unavailable";
}

export const useRuntimeModelLibraries = create<RuntimeModelLibraryState>(() => ({
  installedLtspice: [],
  status: "idle",
}));

let hydration: Promise<void> | null = null;

/**
 * Load only LTspice's four implicit standard-device databases from the user's
 * own installation. They remain ephemeral process state: Tau never copies
 * them into a document, repository, or release bundle. Explicit document and
 * attached models are still ordered first and therefore win name collisions.
 */
export function hydrateInstalledLtspiceStandardModels(): Promise<void> {
  if (hydration) return hydration;
  useRuntimeModelLibraries.setState({ status: "loading" });
  hydration = discoverInstalledLtspiceLibrary()
    .then(async (library) => {
      const standardFiles = installedLtspiceStandardModelFiles(library.files);
      const loaded = await Promise.all(standardFiles.map(async (file) => {
        const model = await readInstalledLtspiceModel(file.id);
        return { name: file.id, text: model.text } satisfies SchematicModelLibrary;
      }));
      useRuntimeModelLibraries.setState({ installedLtspice: loaded, status: "ready" });
    })
    .catch(() => {
      useRuntimeModelLibraries.setState({ installedLtspice: [], status: "unavailable" });
    });
  return hydration;
}
