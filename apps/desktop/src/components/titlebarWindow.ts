import { isTauri } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface WindowBounds {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface MonitorWorkArea {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface TitlebarWindowControls {
  toggleMaximize: () => Promise<void>;
  startDragging: () => Promise<void>;
  outerPosition: () => Promise<{ x: number; y: number }>;
  outerSize: () => Promise<{ width: number; height: number }>;
  setPosition: (position: PhysicalPosition) => Promise<void>;
  setSize: (size: PhysicalSize) => Promise<void>;
  currentMonitor: () => Promise<{ workArea: MonitorWorkArea } | null>;
}

let restoredTitlebarBounds: WindowBounds | null = null;

export async function toggleTitlebarMaximize(window: TitlebarWindowControls): Promise<void> {
  if (restoredTitlebarBounds) {
    const bounds = restoredTitlebarBounds;
    restoredTitlebarBounds = null;
    await window.setPosition(new PhysicalPosition(bounds.position.x, bounds.position.y));
    await window.setSize(new PhysicalSize(bounds.size.width, bounds.size.height));
    return;
  }

  const monitor = await window.currentMonitor();
  if (!monitor) {
    await window.toggleMaximize();
    return;
  }

  restoredTitlebarBounds = {
    position: await window.outerPosition(),
    size: await window.outerSize(),
  };
  await window.setPosition(new PhysicalPosition(monitor.workArea.position.x, monitor.workArea.position.y));
  await window.setSize(new PhysicalSize(monitor.workArea.size.width, monitor.workArea.size.height));
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
  await toggleTitlebarMaximize(window);
}

export async function startCurrentWindowDragging(): Promise<void> {
  if (!isTauri()) return;
  const window = getCurrentWindow() as unknown as TitlebarWindowControls;
  await startTitlebarDragging(window);
}

export async function startTitlebarDragging(window: Pick<TitlebarWindowControls, "startDragging">): Promise<void> {
  await window.startDragging();
}
