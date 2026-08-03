import type { PickedTextFile } from "./fsBridge";

export interface InstalledLtspiceModelFile {
  /** Root-relative opaque id accepted by the fixed-root native read command. */
  id: string;
  name: string;
  category: string;
  bytes: number;
}

export interface InstalledLtspiceLibrary {
  root: string;
  files: InstalledLtspiceModelFile[];
}

async function nativeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { isTauri, invoke } = await import("@tauri-apps/api/core");
  if (!isTauri()) {
    throw new Error("Installed LTspice model discovery is available in the Tau desktop app.");
  }
  return invoke<T>(command, args);
}

export async function discoverInstalledLtspiceLibrary(): Promise<InstalledLtspiceLibrary> {
  return nativeInvoke<InstalledLtspiceLibrary>("discover_installed_ltspice_library");
}

export async function readInstalledLtspiceModel(id: string): Promise<PickedTextFile> {
  return nativeInvoke<PickedTextFile>("read_installed_ltspice_model", { id });
}
