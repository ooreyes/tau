# PDF4 inspector handoff

## P4-07 — suppress the inspector during an active component drag

`SelectionInspector` now accepts `suspended?: boolean` and returns no panel
while it is true, preserving its computed position so the inspector returns
immediately when the gesture ends. The Chrome/App owner should pass the same
boolean that represents an **active selected-component canvas drag** into the
existing `<SelectionInspector>` call:

```tsx
<SelectionInspector suspended={isDraggingSelectedComponent} ... />
```

Do not use the inspector panel's own drag state, selection state, a generic
pointer-down flag, or a wire drag: the required behavior is specifically a
selected component being moved. The unit seam is covered in
`components/inspector/SelectionInspector.test.tsx`.

## P4-07 — case-insensitive reference uniqueness

DOCUMENT owns reference allocation/storage. The inspector must not call
`setLabel` until the proposed reference is verified unique case-insensitively
against every other component. Preserve existing IDs (no automatic renumber),
and make a collision an inline `aria-invalid` + `role="alert"` message. New
placement should allocate the lowest free reference for its prefix. A suitable
store seam is either a non-mutating
`referenceValidationMessage(componentId, candidate): string | null` selector
or a `setLabel` result that reports a collision; the UI needs the message before
mutating the document.

## P4-09 / P4-10 / P4-11 / P4-12 / P4-15 — Chrome-owned inspector wiring

The inspector schema now supplies the behavior/data below; please wire it in
`ShellPanels.tsx` without changing imported semantics.

- Render fields with `field.advanced` beneath a disclosure named **Advanced
  device model parameters**. Generic diode `is` is advanced and has a concise
  leakage/current-curve explanation; normal fields stay in the common view.
- Render every `field.description` as the existing one-line `InspectorHint`
  directly below its row. This supplies the student-facing effect text for
  diode/BJT/JFET/MOSFET/LED/Zener and electromechanical fields.
- For a `field.validate`, use the existing draft/commit validation path (the
  same one numeric bounds use): retain invalid text visibly with inline error,
  and do not call `setValue`. Transformer and CT transformer schemas now
  reject malformed values such as `ejeeje` before a deck is built.
- Native `spdt` exposes a `choice` field. Native `switch` has a kind-aware
  validation message: accept only its static words (Open/Closed and preserved
  legacy aliases), retain an invalid draft with inline error, and never commit
  arbitrary text. A named `switch` model (for example `MYSW`) must preserve its
  exact stored value and offer model resolution rather than coercing it to a
  static contact.
- Do not show **Attach .lib/.sub file** for a Tau-owned generic model already
  resolved to `source === "generic"` without LTspice provenance. Keep it for
  unresolved/named/imported device identities and existing subcircuit/op-amp
  recovery flows. This is surface-only; do not remove model-library/import
  capability.
- Generic LED is the user-facing copy. Its `Color` help says each color has a
  default Vf, and `Forward voltage` help explains the default-versus-override
  behavior. `applyLedColorDefault` already updates an untouched default and
  preserves an explicit override; keep using that helper during `updateParam`.

The former source AC test in `ShellPanels.test.tsx` should look for the
auto-opened **Toggle AC analysis stimulus** disclosure and its `AC amplitude`
field, rather than the old always-visible `AC amplitude (.ac)` label.

## P4-16 — preview value propagation outside Palette

`Palette.tsx` now uses the same `ComponentSymbol` path as the canvas and
updates the symbol viewer on active row, mouse hover, and keyboard focus. It
passes the highlighted item's exact `value`, including CT transformer geometry.
If another placement-preview surface renders `ComponentSymbol` with only a
kind, pass its current tool value too so value-dependent contacts/gates remain
the same geometry as the catalog viewer.
