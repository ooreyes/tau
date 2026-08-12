#!/usr/bin/env python3
"""
Native QA driver for the packaged Tau.app.

The web capture pipeline (`scripts/uiux-followup-shot.mjs`) proves CSS and
geometry, but two claims can only be settled in the packaged app:

  * that the corrected inspectors render the same way inside WKWebView, and
  * that a *physical* double-click on the title bar zooms the window.

The second one matters because the prior pass proved zoom by invoking the
accessibility action directly, which bypasses precisely the code path that was
broken: `startDragging` handing the pointer to the macOS window-drag loop
before the second mouse-down arrives. Only a real double-click tests that.

Clicks and drags are synthesised with Quartz so click *count* is real (a
double-click is one event with clickState 2, not two clicks in a row), and
window geometry is read back through the accessibility API, so every claim
here is a number rather than an impression.

Usage:
  python3 scripts/packaged-qa.py bounds
  python3 scripts/packaged-qa.py shot <out.png>
  python3 scripts/packaged-qa.py click <x> <y>
  python3 scripts/packaged-qa.py dblclick <x> <y>
  python3 scripts/packaged-qa.py drag <x1> <y1> <x2> <y2>
  python3 scripts/packaged-qa.py key <keystroke-applescript>
  python3 scripts/packaged-qa.py type <text>
"""

import subprocess
import sys
import time

import Quartz

APP_NAME = "Tau"


def osa(script: str) -> str:
    out = subprocess.run(
        ["osascript", "-e", script], capture_output=True, text=True, check=False
    )
    if out.returncode != 0:
        raise SystemExit(f"osascript failed: {out.stderr.strip()}")
    return out.stdout.strip()


def window_bounds() -> tuple[int, int, int, int]:
    """(x, y, w, h) of Tau's front window, read through the AX API."""
    raw = osa(
        f'tell application "System Events" to tell process "{APP_NAME}" '
        "to return (get position of window 1) & (get size of window 1)"
    )
    parts = [int(p.strip()) for p in raw.split(",")]
    if len(parts) != 4:
        raise SystemExit(f"unexpected bounds: {raw!r}")
    return tuple(parts)  # type: ignore[return-value]


def activate() -> None:
    osa(f'tell application "{APP_NAME}" to activate')
    time.sleep(0.4)


def _post(event) -> None:
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
    time.sleep(0.05)


def _mouse(kind, x: float, y: float, clicks: int = 1) -> None:
    event = Quartz.CGEventCreateMouseEvent(None, kind, (x, y), Quartz.kCGMouseButtonLeft)
    if clicks > 1:
        Quartz.CGEventSetIntegerValueField(event, Quartz.kCGMouseEventClickState, clicks)
    _post(event)


def move(x: float, y: float) -> None:
    _mouse(Quartz.kCGEventMouseMoved, x, y)


def click(x: float, y: float, clicks: int = 1) -> None:
    move(x, y)
    for n in range(1, clicks + 1):
        _mouse(Quartz.kCGEventLeftMouseDown, x, y, n)
        _mouse(Quartz.kCGEventLeftMouseUp, x, y, n)
    time.sleep(0.35)


def drag(x1: float, y1: float, x2: float, y2: float, steps: int = 24) -> None:
    """A real press-move-release. The intermediate moves are the point: the
    fix only starts a window drag once the pointer has actually travelled."""
    move(x1, y1)
    _mouse(Quartz.kCGEventLeftMouseDown, x1, y1)
    for step in range(1, steps + 1):
        t = step / steps
        _mouse(Quartz.kCGEventLeftMouseDragged, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
    _mouse(Quartz.kCGEventLeftMouseUp, x2, y2)
    time.sleep(0.5)


def _tau_window_id() -> int:
    from Quartz import (
        CGWindowListCopyWindowInfo,
        kCGNullWindowID,
        kCGWindowListOptionOnScreenOnly,
    )

    for window in CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID):
        owner = str(window.get("kCGWindowOwnerName") or "")
        if owner.lower() == APP_NAME.lower():
            return int(window.get("kCGWindowNumber"))
    raise SystemExit(f"no on-screen window owned by {APP_NAME}")


def shot(path: str) -> None:
    """Capture Tau's window by id.

    Deliberately not `screencapture -R <rect>`: on current macOS that path goes
    through ScreenCaptureKit's private-window picker, which raises a consent
    sheet - and the sheet then appears in the screenshot, over the thing being
    photographed. `-l <windowid>` captures the window itself and leaves the
    rest of the desktop (and any system sheet) out of the frame entirely.
    """
    subprocess.run(
        ["screencapture", "-x", "-o", f"-l{_tau_window_id()}", path], check=True
    )


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == "bounds":
        print(",".join(str(v) for v in window_bounds()))
    elif cmd == "shot":
        activate()
        shot(sys.argv[2])
        print(f"captured {sys.argv[2]} at {window_bounds()}")
    elif cmd == "click":
        activate()
        click(float(sys.argv[2]), float(sys.argv[3]))
    elif cmd == "dblclick":
        activate()
        click(float(sys.argv[2]), float(sys.argv[3]), clicks=2)
    elif cmd == "drag":
        activate()
        drag(*(float(v) for v in sys.argv[2:6]))
    elif cmd == "key":
        activate()
        osa(f'tell application "System Events" to {sys.argv[2]}')
        time.sleep(0.4)
    elif cmd == "type":
        activate()
        text = sys.argv[2].replace("\\", "\\\\").replace('"', '\\"')
        osa(f'tell application "System Events" to keystroke "{text}"')
        time.sleep(0.4)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
