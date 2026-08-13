import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
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
import type { ProjectSheetPort, SchematicPortDirection } from "../schematic/types";

const DIRECTIONS: readonly SchematicPortDirection[] = ["In", "Out", "BiDir"];

function directionLabel(direction: SchematicPortDirection): string {
  return direction === "BiDir" ? "BiDir" : direction;
}

/**
 * The child-side half of project hierarchy authoring. A port is not a string
 * guessed from a symbol pin: it is an ordered reference to an existing net
 * label, with the label's text and explicit direction written atomically by
 * `setProjectSheetPorts`. This editor exposes all three authored facts and
 * keeps the compiler's exact-label contract visible while editing.
 */
export function ProjectSheetPortsEditor() {
  const projectPorts = useSchematic((state) => state.projectPorts);
  const netLabels = useSchematic((state) => state.netLabels);
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

  const usedLabelIds = new Set(draft.map((port) => port.labelId));
  const addPort = () => {
    const label = netLabels.find((candidate) => candidate.text.trim() && !usedLabelIds.has(candidate.id));
    if (!label) {
      setError(netLabels.length === 0
        ? "Add a net label to the child sheet before authoring a project port."
        : "Each project port must map to a different net label.");
      return;
    }
    commit([
      ...draft,
      { name: label.text, labelId: label.id, direction: label.port ?? "BiDir" },
    ]);
  };

  const movePort = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target]!, next[index]!];
    commit(next);
  };

  return (
    <div className="project-sheet-ports-editor" role="group" aria-label="Child sheet project ports">
      <p className="property-hint">
        Define the child sheet's public interface in order. Each port name is the mapped net label; Run checks this contract exactly when the sheet is linked.
      </p>
      {draft.length === 0 ? (
        <p className="property-hint" role="status">No project ports yet. Add a labelled child-sheet net.</p>
      ) : (
        <ol className="project-sheet-port-list" aria-label="Ordered child-sheet project ports">
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
      <div className="project-sheet-port-footer">
        <Button type="button" variant="outline" size="sm" onClick={addPort}>
          <Plus size={13} aria-hidden="true" />
          Add project port
        </Button>
        {saved && <span className="property-hint" role="status">Child-sheet interface saved.</span>}
      </div>
      {error && <p className="property-validation-error" role="alert">{error}</p>}
    </div>
  );
}

export function ProjectSheetPortsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px]">
        <DialogHeader>
          <DialogTitle>Child sheet interface</DialogTitle>
          <DialogDescription>
            Author the ordered project ports exposed by this child sheet. Parent links must match these names, directions, and order.
          </DialogDescription>
        </DialogHeader>
        <ProjectSheetPortsEditor />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
