import { getCurrentWindow } from "@tauri-apps/api/window";

export interface TitlebarWindowControls {
  isMaximized: () => Promise<boolean>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  startDragging: () => Promise<void>;
}

export async function toggleTitlebarMaximize(window: TitlebarWindowControls): Promise<void> {
  if (await window.isMaximized()) {
    await window.unmaximize();
  } else {
    await window.maximize();
  }
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
  try {
    const window = getCurrentWindow() as unknown as TitlebarWindowControls;
    await toggleTitlebarMaximize(window);
  } catch {
    // The web preview has no native window transport; the packaged app does.
  }
}

export async function startCurrentWindowDragging(): Promise<void> {
  try {
    const window = getCurrentWindow() as unknown as TitlebarWindowControls;
    await startTitlebarDragging(window);
  } catch {
    // The web preview has no native window transport; the packaged app does.
  }
}

export async function startTitlebarDragging(window: Pick<TitlebarWindowControls, "startDragging">): Promise<void> {
  await window.startDragging();
}
