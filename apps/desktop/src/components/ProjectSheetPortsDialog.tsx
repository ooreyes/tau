import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, MousePointerClick, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useSchematic } from "../store/useSchematic";
import { extractCircuit, netAtPoint } from "../schematic/netlist";
import { orderedProjectSheetUses } from "../schematic/projectSubcircuit";
import type { ProjectSheetPort, SchematicPortDirection } from "../schematic/types";
import "../styles/projectSheets20260824.css";

const DIRECTIONS: readonly SchematicPortDirection[] = ["In", "Out", "BiDir"];

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
  { direction: "In", label: "In", verb: "an input" },
  { direction: "Out", label: "Out", verb: "an output" },
  { direction: "BiDir", label: "Both", verb: "bidirectional" },
];

const EMPTY_INTERFACE_MESSAGE =
  "This sheet has no inputs or outputs marked yet. Mark a net and this sheet can be used as a block on another sheet.";

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
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const labelsById = useMemo(
    () => new Map(netLabels.map((label) => [label.id, label])),
    [netLabels],
  );

  useEffect(() => {
    setDraft(projectPorts.map((port) => ({ ...port })));
    setNameDrafts({});
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

  const usedLabelIds = new Set(draft.map((port) => port.labelId));
  const portPositionByLabelId = new Map(draft.map((port, index) => [port.labelId, index + 1]));

  /**
   * Every net label with a name is a candidate. Nothing is filtered by
   * plausibility and nothing is ranked: the list is the drawing's own facts, in
   * document order, so the user recognises their net instead of trusting us.
   */
  const candidates = netLabels.filter((label) => label.text.trim().length > 0);
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
          <p className="property-hint">
            Mark existing net labels in terminal order. A parent block receives this exact list; it never infers ports from symbols.
          </p>
        </div>
        <dl className="project-sheet-contract-summary" aria-label="Sheet interface summary">
          <div>
            <dt>Ports</dt>
            <dd className="mono-num">{draft.length}</dd>
          </div>
          <div>
            <dt>Order</dt>
            <dd className="mono-num">{draft.length > 0 ? `1 → ${draft.length}` : "—"}</dd>
          </div>
          <div>
            <dt>Run gate</dt>
            <dd>{problems.length > 0 ? "Refused" : draft.length > 0 ? "Ready" : "Unconfigured"}</dd>
          </div>
        </dl>
      </div>
      {draft.length === 0 ? (
        <p className="property-hint" role="status">{EMPTY_INTERFACE_MESSAGE}</p>
      ) : (
        <ol className="project-sheet-port-list" aria-label="Ordered sheet interface ports">
          {draft.map((port, index) => {
            const label = labelsById.get(port.labelId);
            const nameValue = nameDrafts[port.labelId] ?? label?.text ?? port.name;
            return (
              <li key={`${port.labelId}-${index}`} className="project-sheet-port-row">
                <span className="port-index mono-num" aria-hidden="true">{index + 1}</span>
                <label className="project-sheet-port-name">
                  <span className="sr-only">Port {index + 1} name</span>
                  <input
                    className="mono-num property-text"
                    value={nameValue}
                    aria-label={`Port ${index + 1} name`}
                    spellCheck={false}
                    onChange={(event) => setNameDrafts((current) => ({ ...current, [port.labelId]: event.currentTarget.value }))}
                    onBlur={(event) => {
                      renamePortLabel(index, event.currentTarget.value);
                      setNameDrafts((current) => {
                        const next = { ...current };
                        delete next[port.labelId];
                        return next;
                      });
                    }}
                  />
                </label>
                <Select
                  value={port.labelId}
                  onValueChange={(labelId) => updatePort(index, { labelId })}
                >
                  <SelectTrigger size="sm" className="property-select mono-num" aria-label={`Port ${index + 1} label mapping`}>
                    <SelectValue placeholder="Net label" />
                  </SelectTrigger>
                  <SelectContent>
                    {netLabels
                      .filter((candidate) => candidate.id === port.labelId || !usedLabelIds.has(candidate.id))
                      .map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.text || "(unnamed label)"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Select
                  value={port.direction}
                  onValueChange={(direction) => updatePort(index, { direction: direction as SchematicPortDirection })}
                >
                  <SelectTrigger size="sm" className="property-select" aria-label={`Port ${index + 1} direction`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIRECTIONS.map((direction) => (
                      <SelectItem key={direction} value={direction}>{directionLabel(direction)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="project-sheet-port-actions">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move port ${index + 1} up`} disabled={index === 0} onClick={() => movePort(index, -1)}>
                    <ArrowUp size={13} aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move port ${index + 1} down`} disabled={index === draft.length - 1} onClick={() => movePort(index, 1)}>
                    <ArrowDown size={13} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove port ${index + 1}`}
                    onClick={() => commit(draft.filter((_, candidateIndex) => candidateIndex !== index))}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </Button>
                </div>
                <span className="sr-only">Mapped label: {label?.text ?? "missing"}</span>
              </li>
            );
          })}
        </ol>
      )}

      {/* The candidate column: the drawing's nets, with which ones are already
          part of the interface stated rather than implied. */}
      <div className="project-sheet-port-candidates" role="group" aria-label="Nets on this sheet">
        <p className="property-hint">
          {candidates.length === 0
            ? "This sheet has no named nets yet. Label a net first, then mark it."
            : "Nets on this sheet. Choose a direction to mark one as a port."}
        </p>
        {candidates.length > 0 && (
          <ul className="project-sheet-port-candidate-list">
            {candidates.map((label) => {
              const position = portPositionByLabelId.get(label.id);
              const name = label.text.trim();
              return (
                <li key={label.id} className="project-sheet-port-candidate">
                  <span className="mono-num">{name}</span>
                  {netIdByLabelId.get(label.id) === null && (
                    <span className="property-hint">not on a component net</span>
                  )}
                  {position === undefined ? (
                    <span className="project-sheet-port-candidate-actions">
                      {CANDIDATE_CHOICES.map((choice) => (
                        <Button
                          key={choice.direction}
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Mark ${name} as ${choice.verb}`}
                          onClick={() => markCandidate(label.id, choice.direction)}
                        >
                          {choice.label}
                        </Button>
                      ))}
                    </span>
                  ) : (
                    <span className="project-sheet-port-candidate-mark mono-num">Port {position}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

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
          (ui/dialog.tsx:66-67), so an interface panel that now stacks the ordered
          port list, every named net on the sheet, the verdict and the "Used by"
          list grows straight past the viewport on the 900x600 window - and with
          nothing scrollable, both the footer and the "Pick a net on the drawing"
          button end up off-screen and unreachable. Bounding it here rather than
          in ui/dialog.tsx keeps every other dialog's geometry untouched.
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
