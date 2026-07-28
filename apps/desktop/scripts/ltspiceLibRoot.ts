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
  const fromEnv = process.env.TAU_LTSPICE_LIB_ROOT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const staged = join(homedir(), ".tau-autobuilder", "ltspice-models", "lib");
  if (existsSync(staged)) return staged;

  return join(homedir(), "Library", "Application Support", "LTspice", "lib");
}
