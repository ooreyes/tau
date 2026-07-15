---
name: feedback_preserve_uncommitted_fixes
description: Always check git diff for pre-existing uncommitted work before large refactors in this repo, and never restructure files that carry one
metadata:
  type: feedback
---

Tau's working tree can carry a deliberate, uncommitted fix left by the orchestrating agent/user *specifically so a follow-up task preserves it* — e.g. a gesture-only shared-X viewport publish fix in `usePlotViewport.ts` + a matching call-site tweak in `SimulationPanel.tsx`, present when a simplify+retheme task started. The brief named the files and said "preserve it; do not restructure."

**Why:** these fixes are often narrow, easy to clobber accidentally during a big structural edit (e.g. reflowing a component's JSX could silently drop a prop threaded through for the fix), and are NOT yet captured in a commit or test in some cases — the working tree IS the source of truth.
**How to apply:** before any nontrivial edit pass in this repo, run `git status`/`git diff --stat` first. If a file is already modified and the task brief calls it out as "preserve, don't restructure," treat it as read-only except for the minimal integration points explicitly required (e.g. threading a new prop through), and re-check `git diff --stat <file>` after your pass to confirm the line-change count didn't shift unexpectedly.
