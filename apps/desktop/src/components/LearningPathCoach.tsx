import { Button } from "@/components/ui/button";
import type { ContextualHelpTip, LearningPathStatus } from "../lib/learningPath";

/**
 * Compact contextual-help coach for the first-success learning path.
 * Shown while the path is in progress or just completed; parent owns dismiss.
 */
export function LearningPathCoach({
  tip,
  status,
  onDismiss,
  onPrimary,
  primaryLabel,
}: {
  tip: ContextualHelpTip;
  status: LearningPathStatus;
  onDismiss: () => void;
  onPrimary?: () => void;
  primaryLabel?: string;
}) {
  const dismissLabel = status === "completed" ? "Got it" : "Dismiss";

  return (
    <aside
      className="learning-path-coach"
      aria-label="Learning path"
      data-status={status}
      data-tip={tip.id}
    >
      <div className="learning-path-coach-copy">
        <strong className="learning-path-coach-title">{tip.title}</strong>
        <p className="learning-path-coach-body">{tip.body}</p>
        {tip.shortcuts.length > 0 && (
          <ul className="learning-path-coach-shortcuts">
            {tip.shortcuts.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="learning-path-coach-actions">
        {onPrimary && primaryLabel && (
          <Button type="button" size="sm" onClick={onPrimary}>
            {primaryLabel}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </div>
    </aside>
  );
}
