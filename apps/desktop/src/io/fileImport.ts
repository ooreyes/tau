/**
 * Single entry point for "get a file into Tau" - the Explorer header icon, the
 * empty-state Import action, and dropping a file on the editor all call
 * {@link importDroppedFile}. It reads the file, routes it through
 * {@link planFileImport}, and performs whatever store mutation the result
 * calls for (persist + hand back a schematic to open, or attach a model
 * library). It never itself opens a tab - that stays with the caller, which
 * is the only side that knows how to put the result on screen.
 */
import { useProject } from "../store/useProject";
import { useSchematic } from "../store/useSchematic";
import {
  MAX_MODEL_LIBRARIES,
  MAX_MODEL_LIBRARY_TOTAL_LENGTH,
  MAX_SCHEMATIC_FILE_BYTES,
} from "../schematic/documentValidation";
import { planFileImport } from "./importRouter";

export type FileImportOutcome =
  | { kind: "schematic"; path: string; text: string; warnings: string[] }
  | { kind: "model-library"; name: string }
  | { kind: "error"; message: string };

async function ensureProjectDestination(): Promise<string | null> {
  const state = useProject.getState();
  if (state.rootPath) return state.rootPath;
  // Only the "web" capability can turn a picker into a real directory handle.
  // `newProject` covers the other two: it opens the native dialog under Tauri,
  // and seeds the in-memory workspace when there is no filesystem at all - so
  // routing "none" to openFolder (which can only ever return null there) made
  // an import land on "Choose a Schematics folder" with no way to choose one.
  const created = state.capability === "web"
    ? await state.openFolder()
    : await state.newProject("Schematics");
  return created ? useProject.getState().rootPath : null;
}

/**
 * Import a single dropped/picked file. `hasActiveSchematic` gates model
 * library attachment: a library resolves by name against parts on the
 * currently open schematic, so attaching one before any schematic is open
 * would silently land on whatever document happens to be in memory.
 */
export async function importDroppedFile(
  file: File,
  options: { hasActiveSchematic: boolean },
): Promise<FileImportOutcome> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { kind: "error", message: `Could not read "${file.name}".` };
  }

  // Cap the INPUT, before any parser sees it. The schematic byte cap used to be
  // applied only to the synthesized .asc on the way out, which is after
  // tokenize and parse have already run on the attacker's file.
  if (bytes.length > MAX_SCHEMATIC_FILE_BYTES) {
    const mb = (MAX_SCHEMATIC_FILE_BYTES / (1024 * 1024)).toFixed(0);
    return {
      kind: "error",
      message: `"${file.name}" is larger than the ${mb} MB import limit.`,
    };
  }

  let plan: ReturnType<typeof planFileImport>;
  try {
    plan = planFileImport(file.name, bytes);
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : `Could not read "${file.name}".` };
  }

  if (plan.kind === "unsupported") {
    return { kind: "error", message: plan.message };
  }

  if (plan.kind === "model-library") {
    if (!options.hasActiveSchematic) {
      return { kind: "error", message: "Open or create a schematic before attaching a model library." };
    }
    const libraries = useSchematic.getState().userModelLibraries;
    if (libraries.length >= MAX_MODEL_LIBRARIES && !libraries.some((library) => library.name === plan.name)) {
      return { kind: "error", message: `Tau supports up to ${MAX_MODEL_LIBRARIES} attached model files.` };
    }
    const existingTotal = libraries
      .filter((library) => library.name !== plan.name)
      .reduce((sum, library) => sum + library.text.length, 0);
    if (existingTotal + plan.text.length > MAX_MODEL_LIBRARY_TOTAL_LENGTH) {
      return {
        kind: "error",
        message: `Attaching ${plan.name} would exceed the `
          + `${MAX_MODEL_LIBRARY_TOTAL_LENGTH.toLocaleString("en-US")}-character limit for attached model files.`,
      };
    }
    useSchematic.getState().attachModelLibrary({ name: plan.name, text: plan.text });
    return { kind: "model-library", name: plan.name };
  }

  const destination = await ensureProjectDestination();
  if (!destination) {
    return { kind: "error", message: "Choose a Schematics folder to import this file." };
  }
  // An unmodified `.asc` is re-wrapped from its ORIGINAL bytes, not from the
  // decoded `ascText` string, so its on-disk encoding (LTspice often saves
  // UTF-16) survives untouched. Only a synthesized document (converted from a
  // netlist) is built from the generated text.
  const syntheticFile = plan.synthesized
    ? new File([plan.ascText], plan.suggestedFileName, { type: "text/plain" })
    : new File([bytes], plan.suggestedFileName, { type: file.type || "text/plain" });
  const path = await useProject.getState().importAscFile(destination, syntheticFile);
  if (!path) {
    return { kind: "error", message: useProject.getState().error ?? `Could not import "${file.name}".` };
  }
  return { kind: "schematic", path, text: plan.ascText, warnings: plan.warnings };
}
