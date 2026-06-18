# CLAUDE.md — context for AI assistants working on Tau

> **Read [DESIGN_LOG.md](DESIGN_LOG.md) first.** It is the source of truth for
> decisions, current state, open questions, and the append-only session log.
> When you finish a unit of work, **append an entry to the session log** so the
> next agent (Claude, GPT, Gemini, or a human) has continuity.

## What Tau is

A standalone desktop circuit simulator: a SPICE-class engine (ngspice, embedded
natively) behind a modern, fast, beginner-friendly UI. "The power of LTspice
with an interface that doesn't fight you." See [README.md](README.md).

## Repo map

- `apps/desktop/` — Tauri v2 app. Frontend in `src/` (React 19 + TS + Vite),
  Rust shell in `src-tauri/`.
- `packages/schematic-core/` — canonical schematic document model & types.
- `crates/` — Rust engine crates (Phase 3, not yet created).
- `ARCHITECTURE.md` — system design and module boundaries.

## Commands

```bash
pnpm install      # from repo root
pnpm dev          # Tauri desktop app (native window)
pnpm dev:web      # frontend only, in a browser (faster iteration on UI)
pnpm typecheck    # tsc --noEmit on the app
```

## Conventions

- **TypeScript**, no `any` without reason. React function components + hooks.
- **Zustand** for the schematic document store; keep *view* state (pan/zoom)
  local to the canvas, *document* state (components/wires) in the store.
- World coordinates are grid-snapped; `GRID` is defined in `src/schematic/symbols.tsx`.
- Don't hardcode colors — use the CSS variables in `src/App.css`.
- The schematic is the source of truth; netlists are derived, never authored.

## Current phase

**Phase 1 — schematic editor.** Engine (Phase 3) is not wired yet; do not fake
simulation results. If you touch architecture or make a non-obvious choice,
record it in DESIGN_LOG.md.

## Guardrails

- Keep the UI/engine boundary clean (see ARCHITECTURE.md). No SPICE specifics in
  React components.
- License is intentionally proprietary-for-now; do not add an OSS license file.
- Efficiency is a priority — avoid unnecessary re-renders and heavy deps.
