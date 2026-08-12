import { getCurrentWindow } from "@tauri-apps/api/window";

export interface TitlebarWindowControls {
  isMaximized: () => Promise<boolean>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  startDragging: () => Promise<void>;
}

export type TitlebarGestureAction = "drag" | "toggle" | "ignore";

const DOUBLE_CLICK_WINDOW_MS = 500;

const isRecent = (previous: number | null, now: number): boolean =>
  previous !== null && now - previous <= DOUBLE_CLICK_WINDOW_MS;

/**
 * One state machine owns the three browser events a titlebar can receive.
 * Native pointer input is mousedown → click → mousedown → click → dblclick;
 * accessibility activation may only deliver click pairs. Both paths therefore
 * share the same recent-toggle suppression instead of independently toggling.
 */
export function createTitlebarGestureMachine() {
  let lastMouseDownAt: number | null = null;
  let lastClickAt: number | null = null;
  let lastToggleAt: number | null = null;

  const toggled = (now: number): TitlebarGestureAction => {
    lastMouseDownAt = null;
    lastClickAt = null;
    lastToggleAt = now;
    return "toggle";
  };

  return {
    mouseDown(now: number, detail = 1): TitlebarGestureAction {
      const doubleClick = detail >= 2 || isRecent(lastMouseDownAt, now);
      if (doubleClick) return toggled(now);
      lastMouseDownAt = now;
      return "drag";
    },
    click(now: number, detail = 1): TitlebarGestureAction {
      // A click emitted after the pointer path already toggled belongs to that
      // same gesture. It must not become a second toggle.
      if (isRecent(lastToggleAt, now)) return "ignore";
      const doubleClick = detail >= 2 || isRecent(lastClickAt, now);
      if (doubleClick) return toggled(now);
      lastClickAt = now;
      return "ignore";
    },
    doubleClick(now: number): TitlebarGestureAction {
      // Browser dblclick follows the second click. It is observed for event
      // suppression only when mousedown/click already performed the toggle.
      if (isRecent(lastToggleAt, now)) return "ignore";
      return toggled(now);
    },
  };
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
