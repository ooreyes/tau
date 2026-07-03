import { defineConfig } from "vitest/config";

// Config for the acceptance-corpus runner ONLY (scripts/acceptance-corpus.sh).
// The corpus batch-runs ngspice on every file in the user's own LTspice
// corpus, so it lives outside the default `pnpm test` include and gets a
// generous timeout.
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/acceptanceCorpus.corpus.ts"],
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
});
