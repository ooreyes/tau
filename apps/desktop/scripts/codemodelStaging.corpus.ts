// Proof that the engine build refuses to stage an ngspice install with no
// XSPICE code models, and that the resource staged on this machine has them.
//
// XSPICE code models are separate `.cm` modules the library loads at run time.
// An install that produced none still solves every analog circuit, so nothing
// downstream looks wrong until a digital part is simulated - and then it fails
// as an unknown model type, which reads like a broken schematic rather than an
// incomplete engine. `scripts/build-ngspice.sh` staged them behind a bare
// directory test that warned and carried on, so a resource carrying none was a
// warning on a build log nobody re-reads.
//
// The guard case runs the SHIPPED lines, extracted out of the script, rather
// than a paraphrase of them: a reverted guard cannot pass here, because the
// extraction finds nothing to run.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BUILD_SCRIPT = join(REPO_ROOT, "scripts", "build-ngspice.sh");
const RESOURCE_LIB = join(
  REPO_ROOT,
  "apps",
  "desktop",
  "src-tauri",
  "resources",
  "ngspice",
  "lib",
);

/** The set the engine loader asks for (`load_bundled_codemodels` in spice.rs),
 * which is also the set ngspice's own icm makefile builds. The two agreeing is
 * the whole point: a module the loader wants and the build does not produce is
 * a device that fails at run time and nowhere earlier. */
const CODE_MODELS = [
  "spice2poly",
  "analog",
  "digital",
  "xtradev",
  "xtraevt",
  "table",
  "tlines",
];

/** Pull the guard out of the shipped script so the test exercises its bytes. */
function extractGuard(): string {
  const script = execFileSync("sed", [
    "-n",
    "/^missing_codemodels=()/,/^fi$/p",
    BUILD_SCRIPT,
  ]).toString();
  return script;
}

/** Runs the extracted guard against a stage directory; returns its exit code
 * and combined output. */
function runGuard(stageDir: string): { code: number; output: string } {
  const guard = extractGuard();
  try {
    const output = execFileSync(
      "bash",
      ["-c", `set -euo pipefail\nSTAGE_DIR=${JSON.stringify(stageDir)}\n${guard}\necho GUARD_ACCEPTED`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: failure.status ?? -1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

function stageWith(present: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "tau-codemodel-"));
  const dir = join(root, "lib", "ngspice");
  mkdirSync(dir, { recursive: true });
  for (const name of present) {
    writeFileSync(join(dir, `${name}.cm`), "");
  }
  return root;
}

describe("bundled ngspice code models", () => {
  it("extracts a guard from the build script at all", () => {
    // If this fails the rest is vacuous: every negative case below would pass
    // for the wrong reason, because there would be nothing to run.
    expect(extractGuard()).toMatch(/missing_codemodels/);
  });

  it("accepts an install that produced every code model", () => {
    const { code, output } = runGuard(stageWith(CODE_MODELS));
    expect(output).toContain("GUARD_ACCEPTED");
    expect(code).toBe(0);
  });

  it.each(CODE_MODELS)("refuses an install missing %s.cm, and names it", (dropped) => {
    const stage = stageWith(CODE_MODELS.filter((name) => name !== dropped));
    const { code, output } = runGuard(stage);
    expect(output).not.toContain("GUARD_ACCEPTED");
    expect(code).toBe(1);
    expect(output).toContain(`${dropped}.cm`);
  });

  it("refuses an install with no code-model directory at all", () => {
    // The case the old bare directory test reduced to a warning, which is how
    // an engine that could not run a single digital part got staged.
    const root = mkdtempSync(join(tmpdir(), "tau-codemodel-"));
    mkdirSync(join(root, "lib"), { recursive: true });
    const { code, output } = runGuard(root);
    expect(output).not.toContain("GUARD_ACCEPTED");
    expect(code).toBe(1);
    for (const name of CODE_MODELS) {
      expect(output).toContain(`${name}.cm`);
    }
  });

  it("has staged every code model beside the library on this machine", () => {
    // Conditional on a staged engine existing: a fresh clone has none, and the
    // app already fails loudly with no library at all. What this catches is the
    // state that actually shipped - a library present, code models absent.
    const library = existsSync(RESOURCE_LIB)
      ? readdirSync(RESOURCE_LIB).find((name) => /^libngspice.*\.(dylib|so)/.test(name))
      : undefined;
    if (!library) {
      return;
    }
    const staged = existsSync(join(RESOURCE_LIB, "ngspice"))
      ? readdirSync(join(RESOURCE_LIB, "ngspice"))
      : [];
    for (const name of CODE_MODELS) {
      expect(staged, `${name}.cm must be staged beside ${library}`).toContain(`${name}.cm`);
    }
  });
});
