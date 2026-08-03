import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RESPONSE_MARKER = "TAU_SPICE_RESPONSE_V1:";

interface WorkerResponse {
  result: { messages?: string[] } | null;
  error: string | null;
}

export interface NativeWorkerRun {
  ok: boolean;
  error?: string;
  messages: string[];
}

export function nativeWorkerPaths(): { worker: string; library: string } | null {
  const workers = [
    process.env.TAU_NATIVE_WORKER,
    resolve(ROOT, "apps/desktop/src-tauri/target/debug/tau"),
    resolve(ROOT, "apps/desktop/src-tauri/target/release/tau"),
  ].filter((value): value is string => Boolean(value));
  const libraries = [
    process.env.TAU_NGSPICE_LIB,
    resolve(ROOT, "apps/desktop/src-tauri/resources/ngspice/lib/libngspice.dylib"),
    resolve(ROOT, "apps/desktop/src-tauri/resources/ngspice/lib/libngspice.so"),
    resolve(ROOT, "apps/desktop/src-tauri/resources/ngspice/lib/ngspice.dll"),
  ].filter((value): value is string => Boolean(value));
  const worker = workers.find(existsSync);
  const library = libraries.find(existsSync);
  return worker && library ? { worker, library } : null;
}

/** Execute one deck through the same isolated worker, sealed libngspice, and
 * adjacent code-model modules that the desktop app uses. This is intentionally
 * not the system `ngspice` CLI: that executable may be a different version and
 * cannot prove the engine inside Tau.app. */
export function runNativeSpiceWorker(netlist: string, timeoutMs = 20_000): NativeWorkerRun {
  const paths = nativeWorkerPaths();
  if (!paths) return { ok: false, error: "Tau's native worker or staged ngspice library is unavailable.", messages: [] };
  const input = JSON.stringify({
    request: { netlist },
    libraryCandidates: [paths.library],
  });
  const run = spawnSync(paths.worker, ["--tau-spice-worker"], {
    input,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error) return { ok: false, error: run.error.message, messages: [] };
  const stdout = run.stdout ?? "";
  const marker = stdout.indexOf(RESPONSE_MARKER);
  if (marker < 0) {
    const termination = run.signal
      ? ` (signal ${run.signal})`
      : (run.status === null ? "" : ` (exit ${run.status})`);
    return {
      ok: false,
      error: `Tau's native worker returned no response marker${termination}${run.stderr ? `: ${run.stderr.trim()}` : ""}.`,
      messages: [],
    };
  }
  try {
    const response = JSON.parse(stdout.slice(marker + RESPONSE_MARKER.length)) as WorkerResponse;
    return response.result && !response.error
      ? { ok: true, messages: response.result.messages ?? [] }
      : { ok: false, error: response.error ?? "Tau's native worker returned no result.", messages: response.result?.messages ?? [] };
  } catch (error) {
    return { ok: false, error: `Tau's native worker response was invalid: ${error instanceof Error ? error.message : String(error)}`, messages: [] };
  }
}
