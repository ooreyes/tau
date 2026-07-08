import { defineConfig } from "vitest/config";
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
  },
});
