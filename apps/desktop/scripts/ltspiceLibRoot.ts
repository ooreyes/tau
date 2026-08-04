import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where to read real LTspice vendor model files from.
 *
 * Reading them out of LTspice's own `~/Library/Application Support` container
 * makes macOS raise a "would like to access data from other apps" TCC prompt.
 * That is merely annoying interactively, but the autobuilder runs unattended
 * every 10 minutes with nobody present to answer it, so the corpus has to reach
 * these files without touching another app's container.
 *
 * Resolution order:
 *   1. `TAU_LTSPICE_LIB_ROOT` - set by the autobuilder runner.
 *   2. `~/.tau-autobuilder/ltspice-models/lib` - a staged copy in a plain
 *      dotfile directory, which is not TCC-protected.
 *   3. LTspice's real install, for an interactive machine that has granted it.
 *
 * The files are deliberately NOT vendored into the repo: they are Analog
 * Devices and LTspice redistributables, and this repo may be published.
 */
export function ltspiceLibRoot(): string {
  return ltspiceLibRoots()[0]
    ?? join(homedir(), "Library", "Application Support", "LTspice", "lib");
}

/** All readable candidates, in precedence order. A staged autobuilder tree
 * may intentionally contain only the vendor files needed by older gates, so
 * callers looking for several independent standard databases must fall
 * through per file instead of treating the first root as complete. */
export function ltspiceLibRoots(): string[] {
  const candidates = [
    process.env.TAU_LTSPICE_LIB_ROOT,
    join(homedir(), ".tau-autobuilder", "ltspice-models", "lib"),
    join(homedir(), "Library", "Application Support", "LTspice", "lib"),
  ];
  return candidates
    .filter((root): root is string => typeof root === "string" && root.length > 0)
    .filter((root) => existsSync(root))
    .filter((root, index, roots) => roots.indexOf(root) === index);
}
