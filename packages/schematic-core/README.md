# @tau/schematic-core

The **canonical** schematic document model and types for Tau: components, ports,
wires, nets, and (eventually) the Circuit IR that the simulation engine consumes.

> **Status:** this package holds the *intended* public API. During Phase 1 the
> working types live in `apps/desktop/src/schematic/` for iteration speed; they
> will be migrated here once a TS build/project-reference setup is in place
> (see `DESIGN_LOG.md` → OQ3 / tech debt).

## Scope

- Pure, framework-agnostic data model (no React, no DOM).
- Net extraction: schematic graph → connectivity (planned).
- Circuit IR: the neutral representation handed to engine adapters (planned).

Keeping this engine- and UI-agnostic is what lets the frontend and the
simulation backend evolve independently (see `ARCHITECTURE.md`).
