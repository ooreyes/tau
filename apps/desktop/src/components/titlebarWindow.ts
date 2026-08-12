import { getCurrentWindow } from "@tauri-apps/api/window";

export interface TitlebarWindowControls {
  isMaximized: () => Promise<boolean>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  startDragging: () => Promise<void>;
}

export type TitlebarGestureAction = "arm" | "drag" | "toggle" | "ignore";

const DOUBLE_CLICK_WINDOW_MS = 500;

/**
 * How far the pointer must travel before a press becomes a window drag.
 * Below this a press is still a candidate click, which is what makes
 * double-click survivable — see {@link createTitlebarGestureMachine}.
 */
export const TITLEBAR_DRAG_THRESHOLD_PX = 3;

const isRecent = (previous: number | null, now: number): boolean =>
  previous !== null && now - previous <= DOUBLE_CLICK_WINDOW_MS;

/**
 * One state machine owns the events a titlebar can receive.
 * Native pointer input is mousedown → click → mousedown → click → dblclick;
 * accessibility activation may only deliver click pairs. Both paths therefore
 * share the same recent-toggle suppression instead of independently toggling.
 *
 * Mouse-down ARMS a drag; it does not start one. That distinction is the whole
 * point. `startDragging` hands the pointer to the macOS window-drag loop, and
 * the events that loop consumes are exactly the ones double-click detection
 * needs: the second mousedown, the second click, the dblclick. Starting the
 * drag on press therefore made zoom-on-double-click a race against the window
 * server — it was only ever proven here by invoking the accessibility action
 * directly, never by an actual double-click. A press that never moves stays a
 * click; a press that travels past {@link TITLEBAR_DRAG_THRESHOLD_PX} becomes
 * a drag, which is also how a native title bar behaves.
 */
export function createTitlebarGestureMachine() {
  let lastMouseDownAt: number | null = null;
  let lastClickAt: number | null = null;
  let lastToggleAt: number | null = null;
  let armedAt: { x: number; y: number } | null = null;
  let dragging = false;

  const toggled = (now: number): TitlebarGestureAction => {
    lastMouseDownAt = null;
    lastClickAt = null;
    lastToggleAt = now;
    armedAt = null;
    dragging = false;
    return "toggle";
  };

  return {
    mouseDown(now: number, detail = 1, point?: { x: number; y: number }): TitlebarGestureAction {
      const doubleClick = detail >= 2 || isRecent(lastMouseDownAt, now);
      if (doubleClick) return toggled(now);
      lastMouseDownAt = now;
      armedAt = point ? { ...point } : { x: 0, y: 0 };
      dragging = false;
      return "arm";
    },
    /** "drag" exactly once, on the move that crosses the threshold. */
    pointerMove(point: { x: number; y: number }): TitlebarGestureAction {
      if (!armedAt || dragging) return "ignore";
      const travelled = Math.hypot(point.x - armedAt.x, point.y - armedAt.y);
      if (travelled < TITLEBAR_DRAG_THRESHOLD_PX) return "ignore";
      dragging = true;
      // A press that became a drag is no longer half of a double-click.
      lastMouseDownAt = null;
      return "drag";
    },
    pointerUp(): void {
      armedAt = null;
      dragging = false;
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
