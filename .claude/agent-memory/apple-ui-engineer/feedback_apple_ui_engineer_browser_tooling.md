---
name: feedback_apple_ui_engineer_browser_tooling
description: Coordinate-space gotchas and interaction tips for the Claude_Browser MCP tools on this Mac setup
metadata:
  type: feedback
---

`mcp__Claude_Browser__computer`'s screenshot-vs-viewport coordinate relationship is **not a fixed ratio** — it tracks `devicePixelRatio`, which varies by session/display. Two confirmed data points: a 1280x720 viewport with dpr≈1.6 screenshot back at 800x450 (0.625 scale); a 1600x1000 viewport with dpr=2 screenshot back at 800x500 (0.5 scale, i.e. screenshot = viewport / dpr). Don't hardcode either ratio.

**Reliable recipe, in order of preference:**
1. **`ref`-based clicks** (from `read_page`/`find`) — the tool resolves these to the correct point itself. Always prefer this when the target is a real interactive element; it worked correctly every time this session.
2. **Raw coordinates for `left_click`**: read them off the actual screenshot image you're looking at (screenshot-pixel space) — this matched observed behavior.
3. **`left_click_drag` was unreliable** for short, precise drags onto small targets (e.g. a card's reorder handle) — it repeatedly missed and triggered unintended native behavior (SVG pan-drag, text selection) even with coordinates computed from `getBoundingClientRect()` and converted by the dpr ratio. Root-caused as coordinate math, not confirmed — just stopped trying once the JS-dispatch alternative worked reliably.
4. **For pointer-driven drag-and-drop interactions specifically** (custom React `onPointerDown`/`onPointerMove` handlers, not native drag-and-drop), `javascript_tool` dispatching real `PointerEvent`s directly at DOM nodes (not raw coordinates) is far more reliable than either `computer` action: `element.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, composed:true, button:0, buttons:1, pointerId, clientX, clientY}))`, then a `pointermove` dispatched **on the actual target element** (not `window`, not coordinate hit-testing) so React's event target resolution is unambiguous, then `pointerup` on `window`. **Critical:** insert `await new Promise(r => setTimeout(r, 30))` between each dispatch and any DOM read — React 18 batches state updates from native-dispatched events, so reading `element.className` synchronously right after `dispatchEvent` returns sees stale (pre-render) DOM. Without the delay this looks exactly like "the handler never fired" (silent failure), which cost real debugging time before the delay fixed it.
5. **`javascript_tool` dispatched events failed silently** for the schematic canvas's own probe/wire hit-testing (SVG `.wire-hit` clicks calling `netAtPoint`/`snappedCursor`) even with the delay trick — that gesture may depend on real OS-level input specifically. For canvas/wire interactions, stick to `computer` tool clicks (raw screenshot-space coordinates) as in the original guidance below, not JS dispatch.

Each `javascript_tool` call runs in a shared scope — redeclaring `const`/`let` names across calls throws "already declared". Always wrap exec bodies in an IIFE (`(() => { ... })()` or `(async () => { ... })()`) to sandbox locals.

---

Original canvas-specific note (still valid): this app's schematic has no per-element DOM for wires (SVG `.wire-hit` paths, `.pin-target` circles for pins — see project overview memory). For hit-testing wires/pins, get real element rects via `javascript_tool`, convert to screenshot space by multiplying by (screenshot_width / viewport_width) — check this ratio fresh each session, don't assume — then click via the `computer` tool's raw coordinates.

`mcp__Claude_Browser__computer` `scroll` action reliably **times out (30s)** on this app's internal scroll containers (e.g. the maximized `.plotter` panel) even though the page stays fully responsive (confirmed via a follow-up `javascript_tool` eval). Don't retry scroll — go straight to `javascript_tool` and set `element.scrollTop` directly, then screenshot.
