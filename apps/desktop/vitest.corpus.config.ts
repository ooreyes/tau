import { defineConfig } from "vitest/config";

// Config for the corpus specs ONLY (scripts/acceptance-corpus.sh): the
// acceptance-corpus runner plus per-circuit fidelity checks (class-d parity).
// They batch-run ngspice on the user's own LTspice files, so they live
// outside the default `pnpm test` include and get a generous timeout.
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/*.corpus.ts"],
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
});
