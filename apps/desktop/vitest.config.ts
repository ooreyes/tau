import { defineConfig } from "vitest/config";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirrors vite.config.ts's `@/` → src/ alias (shadcn convention) so
    // component tests can import primitives the same way app code does.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Solver + model-layer tests are pure TypeScript; no DOM needed by
    // default. §10 component tests (src/components/ui/*.test.tsx) opt into
    // `// @vitest-environment jsdom` per-file so this default stays "node"
    // and every existing suite keeps its fast, DOM-free run.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],

    // Half the cores, not all of them. Vitest's default (cores - 1) was
    // oversubscribing this machine and the cost was superlinear: at 7 workers
    // on 8 cores the suite took 62s with two App-level timeouts, where the
    // same tests run in ~1.3s each in isolation and ~5.9s under load. At 4
    // workers it was 46s with none, and roughly 2.7x less total worker CPU.
    // Seven jsdom environments each evaluating a module graph that contains
    // SimulationPanel (290KB), App (121KB) and ShellPanels (103KB) is simply
    // more than the box absorbs, and the GC and the single transform server
    // are where it serialises.
    //
    // Derived rather than pinned to 4, so a larger CI box still gets half of
    // what it has.
    maxWorkers: Math.max(2, Math.floor(availableParallelism() / 2)),

    // The App-level suites are the slow ones and sit around 1.5s each at the
    // worker cap above, so 15s is roughly 8x headroom rather than the ~2.5x
    // the 5s default was giving them. Long enough that load never fails a
    // healthy test, short enough that a genuine hang still surfaces quickly.
    // The cap is what fixes the flakiness; this is the margin around it.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
