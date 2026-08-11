import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface TitlebarWindowControls {
  toggleMaximize: () => Promise<void>;
}

/** The native title-bar gesture is deliberately tiny and deterministic. */
export async function handleTitlebarDoubleClick(
  event: { preventDefault: () => void; stopPropagation: () => void },
  toggleMaximize: () => Promise<void>,
): Promise<void> {
  event.preventDefault();
  event.stopPropagation();
  await toggleMaximize();
}

/** Call the Tauri v2 window API only in the packaged/native runtime. */
export async function toggleCurrentWindowMaximize(): Promise<void> {
  if (!isTauri()) return;
  const window = getCurrentWindow() as unknown as TitlebarWindowControls;
  await window.toggleMaximize();
}
