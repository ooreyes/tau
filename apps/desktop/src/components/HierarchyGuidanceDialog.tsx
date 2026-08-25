import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Network, Save, Workflow } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { completeHierarchyGuidance } from "../lib/hierarchyGuidance";
import "../styles/hierarchyGuidance.css";

interface GuidanceStep {
  eyebrow: string;
  title: string;
  body: string;
  detail: string;
  icon: typeof Save;
}

const STEPS: readonly GuidanceStep[] = [
  {
    eyebrow: "01 · Project first",
    title: "Save the sheet inside a project",
    body: "Hierarchy is a real boundary between files. Open or create a Schematics folder, then save the root and child sheets there before wiring them together.",
    detail: "A detached or unsaved sheet stays editable, but Run will stop with an actionable prerequisite instead of guessing where a child belongs.",
    icon: Save,
  },
  {
    eyebrow: "02 · Child interface",
    title: "Name the nets that cross the boundary",
    body: "On the child sheet, use Pick a net on the drawing or the Net label tool. Only named nets can be offered as an interface; symbols and matching text never invent a port.",
    detail: "The authored label and its FLAG/IOPIN direction are saved together and remain undoable.",
    icon: Network,
  },
  {
    eyebrow: "03 · Direction + order",
    title: "Choose Input, Output, or Bidirectional",
    body: "Select a named net, choose its electrical direction, and use the order arrows to review the child terminal sequence. The order is the parent pinout.",
    detail: "Input receives from the parent, Output drives it, and Bidirectional permits both directions. Tau never infers this intent.",
    icon: Check,
  },
  {
    eyebrow: "04 · Parent mapping",
    title: "Place the child sheet as a block",
    body: "On the parent sheet, choose a sibling child in Sheet interface. Tau shows a proposal first; Link this sheet stores the explicit positional edges and pin layout.",
    detail: "The boundary is child port ↔ parent net. Identical label text elsewhere is not global connectivity.",
    icon: Workflow,
  },
  {
    eyebrow: "05 · Recursive Run",
    title: "Save, then run the real hierarchy",
    body: "With both sheets in the project and the mapping confirmed, Run compiles the recursive project deck through packaged ngspice.",
    detail: "Missing files, drift, unsupported engines, or unresolved ports refuse clearly. Tau never flattens or approximates a hierarchy behind your back.",
    icon: ArrowRight,
  },
];

export function HierarchyGuidanceDialog({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => void;
}) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);
  const current = STEPS[step]!;
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;
  const start = () => {
    completeHierarchyGuidance();
    onOpenChange(false);
    onStart();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="hierarchy-guidance-dialog" showCloseButton>
        <DialogHeader>
          <div className="hierarchy-guidance-kicker">Sheet interface guide</div>
          <DialogTitle>Build a truthful boundary between schematics</DialogTitle>
          <DialogDescription>
            A short tour of Tau’s project-sheet workflow. You can replay it any time from the Sheet interface surface.
          </DialogDescription>
        </DialogHeader>

        <div className="hierarchy-guidance-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          <span className="hierarchy-guidance-progress-label">{current.eyebrow}</span>
          <span className="hierarchy-guidance-progress-track" aria-hidden="true">
            {STEPS.map((item, index) => <span key={item.eyebrow} className={index <= step ? "is-current" : undefined} />)}
          </span>
        </div>

        <section className="hierarchy-guidance-step" aria-live="polite">
          <div className="hierarchy-guidance-icon" aria-hidden="true"><Icon size={24} strokeWidth={1.7} /></div>
          <div className="hierarchy-guidance-copy">
            <h3>{current.title}</h3>
            <p>{current.body}</p>
            <p className="hierarchy-guidance-detail">{current.detail}</p>
          </div>
        </section>

        <DialogFooter className="hierarchy-guidance-footer">
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}>
            <ArrowLeft size={14} aria-hidden="true" /> Back
          </Button>
          <span className="hierarchy-guidance-page" aria-hidden="true">{step + 1} / {STEPS.length}</span>
          {isLast ? (
            <Button type="button" size="sm" onClick={start}><Check size={14} aria-hidden="true" /> Start with Sheet interface</Button>
          ) : (
            <Button type="button" size="sm" onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}>Next <ArrowRight size={14} aria-hidden="true" /></Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const HIERARCHY_GUIDANCE_STEP_COUNT = STEPS.length;
