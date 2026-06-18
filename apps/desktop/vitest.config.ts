import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Solver + model-layer tests are pure TypeScript; no DOM needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
