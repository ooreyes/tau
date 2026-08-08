import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { writeFileSync, watchFile } from "node:fs";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/** Agent-stop hook touches this file; broadcast a full reload so the open
 *  Tau window always picks up the latest tree (HMR alone can miss some
 *  structural edits, and packaged builds never see them at all). */
function agentReloadPlugin(): Plugin {
  const stamp = fileURLToPath(new URL("./.agent-reload", import.meta.url));
  return {
    name: "tau-agent-reload",
    configureServer(server) {
      try {
        writeFileSync(stamp, "boot\n", { flag: "a" });
      } catch {
        // Private/read-only trees still get normal HMR; skip the stamp.
        return;
      }
      watchFile(stamp, { interval: 400 }, () => {
        server.ws.send({ type: "full-reload", path: "*" });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), agentReloadPlugin()],

  resolve: {
    // shadcn convention: `@/` → src/ (mirrored in tsconfig paths).
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },

  build: {
    rollupOptions: {
      // Two entry points, one origin. `settings.html` is what the standalone
      // Settings `WebviewWindow` loads; keeping it in the same bundle means the
      // strict CSP (`default-src 'self'`) covers it without being relaxed, and
      // both windows share localStorage for preference sync.
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        settings: fileURLToPath(new URL("./settings.html", import.meta.url)),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
