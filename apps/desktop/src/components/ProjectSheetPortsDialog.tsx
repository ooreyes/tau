import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, MousePointerClick, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { useSchematic } from "../store/useSchematic";
import { extractCircuit, netAtPoint } from "../schematic/netlist";
import { orderedProjectSheetUses } from "../schematic/projectSubcircuit";
import type { ProjectSheetPort, SchematicPortDirection } from "../schematic/types";
import "../styles/projectSheets20260824.css";

function directionLabel(direction: SchematicPortDirection): string {
  return direction === "BiDir" ? "BiDir" : direction;
}

/**
 * How a direction is offered on a candidate net. There is deliberately no
 * default: each button IS the choice, so a port's direction can never be
 * inherited from whatever the net label happened to already carry (PDF5
 * reason 2 - the old flow both picked the net and guessed the intent).
 */
const CANDIDATE_CHOICES: readonly { direction: SchematicPortDirection; label: string; verb: string }[] = [
  { direction: "In", label: "Input", verb: "an input" },
  { direction: "Out", label: "Output", verb: "an output" },
  { direction: "BiDir", label: "Bidirectional", verb: "bidirectional" },
];

export interface ProjectSheetPortsEditorProps {
  /**
   * Parents that instantiate this sheet, supplied by the host (App owns the
   * sheet-interface index). Derived, never stored; `undefined` means "the host
   * has not told us", which is NOT the same claim as "nobody uses this sheet",
   * so the editor says that the mapping is incomplete rather than asserting
   * the sheet is unused. A provided empty array is a confirmed empty result.
   */
  usedBy?: readonly { sheetPath: string; reference: string }[];
  /**
   * When set, this document cannot carry a Tau sheet interface at all (an
   * `.asc` sheet). Refused here, at the point of authoring, instead of
   * silently until save - PDF5 reason 6 on the child side.
   */
  interfaceDisabledReason?: string;
  /** Let the host close the surrounding dialog when we hand the user the drawing. */
  onRequestClose?: () => void;
}

/**
 * The child-side half of project hierarchy authoring. A port is not a string
 * guessed from a symbol pin: it is an ordered reference to an existing net
 * label, with the label's text and explicit direction written atomically by
 * `setProjectSheetPorts`. This editor exposes all three authored facts and
 * keeps the compiler's exact-label contract visible while editing.
 *
 * Item 14 rule: the app never chooses which net becomes a port. Every port
 * here originates in a user gesture that names both the net AND the direction,
 * and the drawing itself ("Pick a net on the drawing") is the primary route.
 */
export function ProjectSheetPortsEditor({
  usedBy,
  interfaceDisabledReason,
  onRequestClose,
}: ProjectSheetPortsEditorProps = {}) {
  const projectPorts = useSchematic((state) => state.projectPorts);
  const netLabels = useSchematic((state) => state.netLabels);
  const components = useSchematic((state) => state.components);
  const wires = useSchematic((state) => state.wires);
  const setProjectSheetPorts = useSchematic((state) => state.setProjectSheetPorts);
  const [draft, setDraft] = useState<ProjectSheetPort[]>(() => projectPorts.map((port) => ({ ...port })));
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [focusedLabelId, setFocusedLabelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const labelsById = useMemo(
    () => new Map(netLabels.map((label) => [label.id, label])),
    [netLabels],
  );

  useEffect(() => {
    setDraft(projectPorts.map((port) => ({ ...port })));
    setNameDrafts({});
    setFocusedLabelId(null);
    setError(null);
    setSaved(false);
  }, [projectPorts]);

  const commit = (next: ProjectSheetPort[], labelTextById?: Readonly<Record<string, string>>) => {
    const result = setProjectSheetPorts(next, labelTextById);
    if (!result.ok) {
      setError(result.error ?? "Could not save the child-sheet port contract.");
      setSaved(false);
      return false;
    }
    setDraft(next.map((port) => ({ ...port })));
    setError(null);
    setSaved(true);
    return true;
  };

  const renamePortLabel = (index: number, nextName: string) => {
    const port = draft[index];
    const label = port ? labelsById.get(port.labelId) : undefined;
    const trimmed = nextName.trim();
    if (!port || !label) return;
    if (!trimmed) {
      setError("A project port needs a non-empty net-label name.");
      return;
    }
    if (trimmed === label.text) return;
    const next = draft.map((candidate, candidateIndex) => (
      candidateIndex === index ? { ...candidate, name: trimmed } : candidate
    ));
    commit(next, { [port.labelId]: trimmed });
  };

  const updatePort = (index: number, update: Partial<ProjectSheetPort>) => {
    const next = draft.map((port, candidateIndex) => (
      candidateIndex === index ? { ...port, ...update } : port
    ));
    const changedLabel = update.labelId ? labelsById.get(update.labelId) : undefined;
    if (changedLabel) next[index] = { ...next[index]!, name: changedLabel.text };
    commit(next);
  };

  /**
   * Which electrical net each net label actually sits on, computed with the
   * SAME two functions the fail-closed compiler uses (`extractCircuit` +
   * `netAtPoint`, projectHierarchy.ts:198-206). Deliberately not a second rule:
   * if these ever disagree with Run, the test in this file's
   * "child-side agreement with the compiler" block fails, because it derives
   * its expected wording from the message the compiler throws.
   *
   * `null` means "no net, or a net with no component pin" - the exact condition
   * Run refuses with 'does not connect to a component net'.
   */
  const netIdByLabelId = useMemo(() => {
    const nets = extractCircuit(components, wires, netLabels).nets;
    const map = new Map<string, string | null>();
    for (const label of netLabels) {
      const net = netAtPoint(nets, wires, label);
      map.set(label.id, net && net.pins.length > 0 ? net.id : null);
    }
    return map;
  }, [components, wires, netLabels]);

  /**
   * The two authoring mistakes Run refuses, said here instead - at the moment
   * of the gesture, on the sheet that caused them, instead of on a parent sheet
   * after a Run. Advisory only: nothing is blocked and nothing is repaired, so
   * a student can mark a net first and wire it second.
   */
  const problems = useMemo(() => {
    const found: string[] = [];
    const owners = new Map<string, string>();
    for (const port of draft) {
      const netId = netIdByLabelId.get(port.labelId) ?? null;
      if (netId === null) {
        found.push(`${port.name} does not connect to a component net. Run refuses the sheet until this net reaches a component pin.`);
        continue;
      }
      const owner = owners.get(netId);
      if (owner !== undefined) {
        found.push(`${owner} and ${port.name} cannot share one electrical net.`);
        continue;
      }
      owners.set(netId, port.name);
    }
    return found;
  }, [draft, netIdByLabelId]);

  /**
   * Every net label with a name is a candidate. Nothing is filtered by
   * plausibility and nothing is ranked: the list is the drawing's own facts, in
   * document order, so the user recognises their net instead of trusting us.
   */
  const candidates = netLabels.filter((label) => label.text.trim().length > 0);
  const displayCandidates = [...candidates].sort((left, right) => {
    const leftOrder = draft.findIndex((port) => port.labelId === left.id);
    const rightOrder = draft.findIndex((port) => port.labelId === right.id);
    if (leftOrder >= 0 && rightOrder >= 0) return leftOrder - rightOrder;
    if (leftOrder >= 0) return -1;
    if (rightOrder >= 0) return 1;
    return 0;
  });
  // A stale stored port remains visible as an honest drift row instead of
  // disappearing from the editor. Normal rows are the drawing's named labels
  // in document order; nothing is inferred from a shared text name.
  const candidateIds = new Set(candidates.map((label) => label.id));
  const stalePorts = draft.filter((port) => !candidateIds.has(port.labelId));
  const orderedUsedBy = useMemo(
    () => usedBy === undefined ? undefined : orderedProjectSheetUses(usedBy),
    [usedBy],
  );

  const markCandidate = (labelId: string, direction: SchematicPortDirection) => {
    const label = labelsById.get(labelId);
    if (!label) return;
    const name = label.text.trim();
    // `setProjectSheetPorts` enforces name === label text exactly. If the label
    // carries stray whitespace the only way to satisfy that invariant is to
    // write the trimmed spelling to BOTH, in the same transaction, which is
    // what labelTextById is for. Direction comes from the button, never the label.
    const labelTextById = name === label.text ? undefined : { [labelId]: name };
    commit([...draft, { name, labelId, direction }], labelTextById);
    setFocusedLabelId(labelId);
  };

  const removePort = (labelId: string) => {
    commit(draft.filter((port) => port.labelId !== labelId));
    setFocusedLabelId(null);
  };

  const movePort = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target]!, next[index]!];
    commit(next);
  };

  // When the sheet cannot take an interface, offer no live control: an enabled
  // control that always refuses is worse than a sentence saying why.
  //
  // This used to fire for every `.asc`, on the grounds that such a document
  // cannot hold a `projectPorts` array. That was true and beside the point - the
  // format states each port as a `FLAG` plus an adjacent `IOPIN <dir>`, which is
  // exactly what this dialog writes, and the compiler now reads that contract.
  // The remaining reason is the honest one: a sheet that has never been saved
  // into the project has no path for a parent to point at.
  if (interfaceDisabledReason) {
    return (
      <div className="project-sheet-ports-editor" role="group" aria-label="Sheet interface">
        <p className="property-validation-error project-sheet-port-disabled" role="note">
          {interfaceDisabledReason}
        </p>
      </div>
    );
  }

  return (
    <div className="project-sheet-ports-editor" role="group" aria-label="Sheet interface">
      <div className="project-sheet-contract-head">
        <div>
          <p className="project-sheet-eyebrow">Public contract</p>
          <p className="project-sheet-section-meta">Select the boundary nets</p>
          <p className="property-hint">
            Each named net appears once. Select a row, choose its direction, then use the arrows to review the terminal order sent to the parent.
          </p>
        </div>
        <dl className="project-sheet-contract-summary" aria-label="Sheet interface summary">
          <div><dt>Exposed</dt><dd className="mono-num">{draft.length}</dd></div>
          <div><dt>Order</dt><dd className="mono-num">{draft.length > 0 ? `1 → ${draft.length}` : "—"}</dd></div>
          <div><dt>Run gate</dt><dd>{problems.length > 0 ? "Refused" : draft.length > 0 ? "Ready" : "Unconfigured"}</dd></div>
        </dl>
      </div>

      {candidates.length === 0 && stalePorts.length === 0 ? (
        <p className="property-hint" role="status">This sheet has no inputs or outputs marked yet. Mark a net and this sheet can be used as a block on another sheet.</p>
      ) : (
        <div className="project-sheet-net-picker" role="group" aria-label="Named nets on this sheet">
          <div className="project-sheet-net-picker-head">
            <span className="project-sheet-section-heading">Named nets</span>
            <span className="project-sheet-section-meta">select to expose</span>
          </div>
          <ul className="project-sheet-net-list" aria-label="Named nets">
            {displayCandidates.map((label) => {
              const portIndex = draft.findIndex((port) => port.labelId === label.id);
              const port = portIndex >= 0 ? draft[portIndex] : undefined;
              const selected = port !== undefined;
              const name = label.text.trim();
              const focused = focusedLabelId === label.id;
              const netIsGrounded = netIdByLabelId.get(label.id) === null;
              return (
                <li key={label.id} className={`project-sheet-net-row${selected ? " is-exposed" : ""}${focused ? " is-focused" : ""}`}>
                  <button
                    type="button"
                    className="project-sheet-net-select"
                    aria-pressed={selected || focused}
                    aria-label={selected ? `Deselect ${name}` : focused ? `Selected ${name}; choose a direction` : `Select ${name}`}
                    onClick={() => selected
                      ? removePort(label.id)
                      : setFocusedLabelId((current) => current === label.id ? null : label.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (selected) removePort(label.id);
                        else setFocusedLabelId((current) => current === label.id ? null : label.id);
                      }
                    }}
                  >
                    <span className="project-sheet-net-check" aria-hidden="true">{selected ? <Check size={13} /> : null}</span>
                    <span className="mono-num project-sheet-net-name">{name}</span>
                    {selected && <span className="project-sheet-net-order mono-num">Port {portIndex + 1}</span>}
                    {!selected && <span className="project-sheet-net-state">Available</span>}
                  </button>
                  <div className="project-sheet-net-controls">
                    {CANDIDATE_CHOICES.map((choice) => (
                      <Button
                        key={choice.direction}
                        type="button"
                        variant={port?.direction === choice.direction ? "secondary" : "outline"}
                        size="sm"
                        aria-pressed={port?.direction === choice.direction}
                        aria-label={`${selected ? "Set" : "Mark"} ${name} as ${choice.verb}`}
                        onClick={() => selected
                          ? updatePort(portIndex, { direction: choice.direction })
                          : markCandidate(label.id, choice.direction)}
                      >
                        {choice.label}
                      </Button>
                    ))}
                    {selected && (
                      <>
                        <span className="project-sheet-port-actions">
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move port ${portIndex + 1} up`} disabled={portIndex === 0} onClick={() => movePort(portIndex, -1)}><ArrowUp size={13} aria-hidden="true" /></Button>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move port ${portIndex + 1} down`} disabled={portIndex === draft.length - 1} onClick={() => movePort(portIndex, 1)}><ArrowDown size={13} aria-hidden="true" /></Button>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove port ${portIndex + 1}`} onClick={() => removePort(label.id)}><Trash2 size={13} aria-hidden="true" /></Button>
                        </span>
                      </>
                    )}
                  </div>
                  <span className="project-sheet-net-note">
                    {netIsGrounded ? "not on a component net" : selected ? `Child port ${portIndex + 1} · ${directionLabel(port!.direction)}` : ""}
                  </span>
                  {selected && (
                    <label className="project-sheet-net-rename">
                      <span className="sr-only">Port {portIndex + 1} name</span>
                      <input
                        className="mono-num property-text"
                        value={nameDrafts[label.id] ?? label.text}
                        aria-label={`Port ${portIndex + 1} name`}
                        spellCheck={false}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setNameDrafts((current) => ({ ...current, [label.id]: value }));
                        }}
                        onBlur={(event) => {
                          const value = event.currentTarget.value;
                          renamePortLabel(portIndex, value);
                          setNameDrafts((current) => { const next = { ...current }; delete next[label.id]; return next; });
                        }}
                      />
                    </label>
                  )}
                </li>
              );
            })}
            {stalePorts.map((port) => (
              <li key={port.labelId} className="project-sheet-net-row is-drifted">
                <div className="project-sheet-net-select" role="status">
                  <span className="project-sheet-net-check" aria-hidden="true">!</span>
                  <span className="mono-num project-sheet-net-name">{port.name}</span>
                  <span className="project-sheet-net-state">Stored port is missing from this sheet</span>
                </div>
                <span className="property-validation-error">Run is refused until this explicit mapping is repaired.</span>
              </li>
            ))}
          </ul>
          <p className="property-hint project-sheet-net-picker-help">
            Direction is explicit: In receives from the parent, Out drives the parent, and Both is bidirectional. A selection never matches another sheet by label text.
          </p>
        </div>
      )}
      {draft.length === 0 && candidates.length > 0 && (
        <p className="property-hint" role="status">
          This sheet has no inputs or outputs marked yet. Mark a net and this sheet can be used as a block on another sheet.
        </p>
      )}

      {/* One verdict on the interface as a whole: either the two refusals Run
          would give, or the pinout a parent will receive - in order, because
          the contract is positional. Never both, and never silence. */}
      {problems.length > 0 ? (
        <ul className="project-sheet-port-problems" role="alert">
          {problems.map((problem) => (
            <li key={problem} className="property-validation-error">{problem}</li>
          ))}
        </ul>
      ) : draft.length > 0 && (
        <p className="property-hint project-sheet-port-ready" role="status">
          Ready: another sheet can use this one as a block. Pinout in order: {draft.map((port) => port.name).join(", ")}.
        </p>
      )}

      <div className="project-sheet-port-usedby" role="group" aria-label="Parent mapping">
        <div className="project-sheet-section-heading">
          <span>Parent mapping</span>
          <span className="project-sheet-section-meta">confirmed edges only</span>
        </div>
        {orderedUsedBy === undefined ? (
          <p className="property-hint">
            Parent mapping is not fully indexed yet. Open parent sheets are reported here when discovered; a blank list is not proof that this sheet is unused.
          </p>
        ) : orderedUsedBy.length === 0 ? (
          <p className="property-hint">No open parent currently instantiates this sheet. It remains available as a child sheet.</p>
          ) : (
            <ul className="project-sheet-port-usedby-list">
              {orderedUsedBy.map((use) => (
                <li key={`${use.sheetPath}-${use.reference}`} className="mono-num">
                  <span>{use.sheetPath}</span>
                  <span aria-hidden="true">→</span>
                  <span>{use.reference}</span>
                </li>
              ))}
            </ul>
          )}
      </div>

      <div className="project-sheet-port-footer">
        {/* The primary route is the drawing, not this table: arm the label tool
            and get out of the way. This creates NOTHING by itself. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            useSchematic.getState().startLabeling();
            onRequestClose?.();
          }}
        >
          <MousePointerClick size={13} aria-hidden="true" />
          Pick a net on the drawing
        </Button>
        {/* Not a live region: the interface verdict above already announces the
            state, and two live regions on one edit read as noise. */}
        {saved && <span className="property-hint">Sheet interface saved.</span>}
      </div>
      {error && <p className="property-validation-error" role="alert">{error}</p>}
    </div>
  );
}

export function ProjectSheetPortsDialog({
  open,
  onOpenChange,
  usedBy,
  interfaceDisabledReason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & Pick<ProjectSheetPortsEditorProps, "usedBy" | "interfaceDisabledReason">) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px]">
        <DialogHeader>
          <DialogTitle>Sheet interface</DialogTitle>
          <DialogDescription>
            Mark the nets this sheet exposes as inputs and outputs, in order. Another sheet can then use this one as a block, and its pinout arrives from here.
          </DialogDescription>
        </DialogHeader>
        {/*
          The body scrolls, the header and the Done footer do not. `DialogContent`
          is `fixed top-1/2 -translate-y-1/2` with NO max-height and NO overflow
          (ui/dialog.tsx:66-67), so an interface panel with many named net rows,
          the verdict and the "Used by" list grows straight past the viewport on
          the 900x600 window - and with nothing scrollable, both the footer and
          the "Pick a net on the drawing" button end up off-screen and
          unreachable. Bounding it here rather than in ui/dialog.tsx keeps every
          other dialog's geometry untouched.
        */}
        <div className="max-h-[min(60vh,26rem)] overflow-y-auto" data-slot="sheet-interface-scroll">
          <ProjectSheetPortsEditor
            usedBy={usedBy}
            interfaceDisabledReason={interfaceDisabledReason}
            onRequestClose={() => onOpenChange(false)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
