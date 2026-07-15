---
name: project_tau_assistant_column
description: How the AI assistant ("Ask Tau") column was implemented — files, wiring points, and discovered scaffolding that predicted this exact feature
metadata:
  type: project
---

Built 2026-07-12: a third resizable simulator column, `AssistantPanel.tsx`, that chats with Claude (`claude-opus-4-8` via `@anthropic-ai/sdk` streaming) grounded in the live circuit/netlist/telemetry. Closed by default, toggled from the activity rail's Sparkles icon.

**Files:**
- `apps/desktop/src/lib/assistant.ts` — Anthropic client wrapper (`streamAssistantReply`, error classification), API-key localStorage (`tau.assistant.apiKey`) + `useAssistantApiKey()` reactive hook (custom event `tau:assistant-api-key-changed`, since same-tab `storage` events don't fire).
- `apps/desktop/src/lib/assistantContext.ts` — pure context builder (netlist via `buildSpiceDeck`, component+telemetry lines, transient analysis stats/warnings/.meas, selection), capped ~4000 chars, unit-tested.
- `apps/desktop/src/lib/miniMarkdown.tsx` — tiny markdown renderer (code fences, bold, inline code, lists) for assistant replies, no dependency.
- `apps/desktop/src/components/AssistantPanel.tsx` — the chat UI; exports `ASSISTANT_PANEL_WIDTH` config and `loadAssistantOpen`/`saveAssistantOpen`.
- Tests: `lib/assistantContext.test.ts`, `components/AssistantPanel.test.tsx` (mocks `@anthropic-ai/sdk` via `vi.mock` + `vi.hoisted`, fake `MessageStream` with `on`/`finalMessage`/`abort`).

**Wiring points in App.tsx:** `assistantOpen`/`assistantResize` (lifted `usePanelWidth` call, not self-contained like TelemetryDock — the responsive-floor effect needs to read+shrink it), `--assistant-w` CSS var on `.shell-body`, rendered as a sibling after the `graphOpen`/`!graphOpen` conditional blocks. `ActivityRail` (ShellPanels.tsx) got a new required `assistantOpen`/`onToggleAssistant` prop pair. Settings sheet (`SettingsPanel` in ShellPanels.tsx) got a new `.settings-section`/`.settings-field` block (password input) above the existing `.settings-row` list.

**Enhancement to shared `panelResize.tsx`:** `usePanelWidth()` now also returns `setWidth` (an alias for the internal clamped `applyWidth`) so a lifted caller can shrink a panel programmatically (mirrors how `scopeWidth`'s own clamp effect works) without duplicating drag logic. Additive, non-breaking — verify it's still there before reusing (`grep "setWidth: applyWidth" apps/desktop/src/components/panelResize.tsx`).

**Notable pre-existing discovery:** App.css already had dead scaffolding anticipating this exact feature — a `--scope-w` CSS var on `.shell-body` that's never consumed by any rule, comments literally saying "Ask Sim columns," and an orphaned `.panel-close` class with a comment describing "Ask Sim's own minimize button." None of it was wired to real JSX. This session activated `.panel-close` for real (AssistantPanel's header close button) and updated those stale comments to say "Assistant" instead of reverting/removing them. `--scope-w` and the scope column's own drag handle are STILL unwired/dead (out of scope, left alone — `.plotter` is still `flex:1` auto, not var-driven).

Related: [[project_tau_overview]], [[feedback_apple_ui_engineer_browser_tooling]]
