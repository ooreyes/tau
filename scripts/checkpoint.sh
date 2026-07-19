#!/usr/bin/env bash
# Durability net for the autonomous builder.
#
# Runs from the Claude Code `Stop` / `SubagentStop` hooks: after every agent
# turn it commits and pushes any work-in-progress so a usage cutoff or an
# ephemeral-sandbox teardown can NEVER lose uncommitted work. This is the fix
# for "Claude runs out of usage before it commits."
#
# Scoped to `auto/*` branches only, so it never silently commits a human's
# interactive session on feat/* or main. It is a no-op when the tree is clean
# (the common case, because the routine commits its own semantic units).
set -uo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0

branch="$(git branch --show-current 2>/dev/null)"
case "$branch" in
  auto/*) ;;          # only the autobuilder's branches
  *) exit 0 ;;
esac

# Nothing to save - the routine already committed this unit.
if git diff --quiet && git diff --cached --quiet; then
  exit 0
fi

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
git add -A
git commit --no-verify -q -m "wip: checkpoint ${ts} [auto-durability]" || exit 0

# Best-effort push so committed work survives sandbox teardown. Never fail the
# hook on a transient network/auth error - the local commit already protects it.
git push -q origin "HEAD:${branch}" 2>/dev/null || true
exit 0
