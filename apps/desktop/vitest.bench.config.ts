// TEMPORARY. Runs only the out-of-tree netlist harness in `bench/`, which the
// main config deliberately cannot see (its include is `src/**`). Delete with
// `bench/` once the optimisation is verified.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["bench/**/*.test.ts"], testTimeout: 600_000 },
});
