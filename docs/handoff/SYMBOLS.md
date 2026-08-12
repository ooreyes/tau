# SYMBOLS lane — cross-lane requests (P3-01, P3-03, P3-08)

## apps/desktop/src/components/ShellPanels.tsx (EXPLORER owns)
Why: the inspector title is the surface PDF-3 item 1 caught lying — "DC source"
over a Waveform selector reading Sine. `componentDisplayName` now derives the
name from `(kind, value)`; the call site still passes only the kind.
Exact change: at the inspector title (`componentDisplayName(selected.kind)`,
around `:1749`) pass the value too:

```diff
-{componentDisplayName(selected.kind)}
+{componentDisplayName(selected.kind, selected.value)}
```

The second argument is optional and is ignored for every kind that is not an
independent source, so this is safe to apply unconditionally and cannot change
any other part's title. Proven by
`schematic/componentNames.test.ts` → "leaves the one-argument answer and every
non-source kind exactly as they were".
Blocks: P3-01's title clause. Nothing else in the item depends on it.

## apps/desktop/src/components/ShellPanels.tsx (EXPLORER owns)
Why: a `vac`/`iac`/`vpulse` whose waveform changes must move kind and value in
ONE undoable transaction, or the alias's compact positional codec reads the new
function value as garbage (`decodeParams("vac", "PULSE(0 5 …)")` →
`{offset: "PULSE(0", amplitude: "5", frequency: "0"}`), which reaches
`ascExport.ts` and the canvas caption.
Exact change: at the `IndependentSourceEditor` call site (around `:1835-1842`)
pass the new optional prop, wired to the new store action:

```diff
   onValueChange={(next) => setValue(selected.id, next)}
+  onIdentityChange={(kind, next) => setSourceIdentity(selected.id, kind, next)}
```

`setSourceIdentity` is exported from `store/useSchematic.ts` and takes its own
history snapshot, so no `beginParamChange` call belongs beside it. It returns
`false` and does nothing for any pair outside the closed
`vac|vpulse → vsource`, `iac → isource` table.
The prop is optional: without it the editor still applies the waveform through
`onValueChange` (pinned by "still applies the waveform when no identity seam is
wired"), so the two changes can land in either order.
Blocks: P3-01's clause 4 only, in the running app. The store and editor halves
are both tested and green already.

## apps/desktop/src/components/CommandPalette.tsx (no lane owns)
Why: P3-03's "every palette glyph". The part-search list renders
`ComponentSymbol` with no value at all, and `ledColorFromValue("")` answers
`"red"`, so its LED row is tinted too.
Exact change: at `:128`, add the flag this lane added to `ComponentSymbol`:

```diff
-<ComponentSymbol kind={...} />
+<ComponentSymbol kind={...} catalog />
```

Already mitigated, so this is not blocking: `styles/sourceSymbols.css` adds
`.cmdk-icon .symbol .led-artwork { stroke: var(--comp) }`, which matches at the
same specificity as the App.css tint and wins on source order. The flag is the
cleaner fix and the CSS rule stays correct either way.
Blocks: nothing.

## apps/desktop/src/components/Canvas.tsx (CANVAS owns)
Why: same as above for the placement ghost — `.symbol .led-artwork.led-color-red`
(0,3,0) outranks `.ghost .symbol` (0,2,0), so an LED ghost previewed as a solid
red part instead of the dashed accent.
Exact change: at the ghost's `ComponentSymbol` (around `:1896`), add `catalog`.
Already mitigated by `.ghost .symbol .led-artwork { stroke: var(--accent) }` in
`styles/sourceSymbols.css`.
Blocks: nothing.

## Canvas.tsx ghost + findFreeSpot for ground — DO NOT ALSO FIX (coordination)
The orchestrator's note says SYMBOLS' `startPlacing` normalisation covers this
and CANVAS should not touch `Canvas.tsx:1942`. Recording the reason here so it
is not rediscovered: `startPlacing("ground")` now sets
`placeRotation: 0, placeMirror: false`, and the ghost transform, `findFreeSpot`'s
collision footprint and `addComponent` all read those same two fields, so all
three agree from one edit. `addComponent` keeps its own ground guard as a
backstop for a direct `setState`.

## PWL / EXP / SFFM source glyphs — flagged, not invented
`vsource`/`isource` artwork now follows the value for DC, sine and pulse, by
reusing the existing `vac` / `iac` / `vpulse` glyphs (already clearance-tested).
The other three waveforms have no glyph anywhere in the repo, and hand-authoring
three needs the `tau-instrument-aesthetic` pass plus its own clearance proofs
inside the r = 15 source circle. They currently fall through to the DC drawing.
Owner: whoever picks up the aesthetic pass. Not part of any P3 done-when.

## Informational — P3-08's ".asc round-trip" clause is unsatisfiable as written
`ascExport.ts:609` writes ground as an LTspice `FLAG x y 0` record, which has no
orientation field, and `ascImport.ts:2211` reads every `FLAG` back as
`rotation: 0`. So "an explicit user rotation after placement … still round-trips
through `.asc`" cannot hold for ground without inventing a Tau carrier
attribute in files this lane does not own. The lane instead pins the two halves
that ARE real: an explicit post-placement rotation is honoured and undoable, and
the store never normalises a loaded document (`loadCircuit` / `replaceCircuit` /
`restoreCircuit` all keep an authored `rotation: 90`), so import fidelity is
preserved wherever the format can express it.
