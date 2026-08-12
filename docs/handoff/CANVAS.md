# CANVAS handoff requests

Nothing here blocks P3-07, P3-10 or P3-11 — all three are complete inside the
lane's owned files. These are dependencies and stale comments the orchestrator
should be aware of.

## apps/desktop/src/App.tsx (owned by DOCK) — dependency, no change requested
Why: P3-10's fit now reserves the band the parts rail covers by reading the
`--stage-rail-inset` custom property that `App.tsx:3543-3545` publishes on
`<main className="stage">` (the same number `.view-controls` already positions
against in `App.css:4504-4512`). A prop was deliberately not re-added, so that
`Canvas.simulator.test.tsx:478-487`'s `@ts-expect-error fitInsetRight` stays a
valid directive.
Exact change: none. If DOCK renames, removes or moves that property off
`.stage`, fit centring silently regresses to the reported behaviour. The guard
is `Canvas.shapes.test.tsx` → "centres the circuit in the visible box at
… rail open", which fails by ~132 px if the property disappears.
Blocks: nothing.

## apps/desktop/src/App.tsx:3113-3115 (owned by DOCK) — optional cleanup
Why: the window keydown handler bails on
`closest("input, textarea, select, button, [role='button'], …")` before it
resolves a shortcut. A focused net label matches `[role='button']` by role
alone, which is the whole of P3-11: the global `Backspace` → delete binding in
`shortcuts.ts:134` is unreachable the moment the label takes focus.
Exact change: none required — P3-11 is fixed inside `Canvas.tsx` by having the
label answer Delete/Backspace itself. The cleaner long-term shape is to narrow
that guard to elements that actually accept text entry (or add
`:not(.net-label-text)`), after which the local handler becomes belt-and-braces
rather than load-bearing. `Canvas.shapes.test.tsx` → "documents that the label
matches App.tsx's window-keydown swallow guard" pins the current shape, so
narrowing it is a visible, deliberate change rather than a silent one.
Blocks: nothing.

## apps/desktop/src/components/Canvas.simulator.test.tsx (owned by no lane) — stale comment
Why: its `@ts-expect-error` at :484 carries the comment "Components is a
summoned overlay, never a fit reservation", which is the judgement `b3c7708`
landed and P3-10 explicitly reverses. The test still passes untouched (the
prop surface is unchanged; the reservation is measured off the DOM), but the
comment now states a policy the product no longer holds.
Exact change: reword the comment to say the rail's reservation is measured from
`--stage-rail-inset` on `.stage` rather than passed as a prop, so a future
reader does not restore the un-inset fit on the strength of it.
Blocks: nothing.
