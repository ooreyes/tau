import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Read a production file relative to apps/desktop for source-level contracts. */
export function readDesktopSource(relativePath: string): string {
  return readFileSync(join(DESKTOP_ROOT, "src", relativePath), "utf8");
}

/** Return the balanced body of a simple CSS rule, preserving nested functions. */
export function cssRuleBody(css: string, selector: string): string {
  const marker = `${selector} {`;
  const markerStart = css.indexOf(marker);
  if (markerStart < 0) throw new Error(`Missing CSS rule: ${selector}`);

  const open = css.indexOf("{", markerStart);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const character = css[index];
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }

  throw new Error(`Unclosed CSS rule: ${selector}`);
}

/** Custom properties declared by a stylesheet, excluding var() references. */
export function declaredCustomProperties(css: string): ReadonlySet<string> {
  return new Set(
    [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((match) => match[1]!),
  );
}

/** Custom properties referenced through var(), useful for token drift checks. */
export function referencedCustomProperties(source: string): readonly string[] {
  return [...source.matchAll(/var\(\s*(--[a-z0-9-]+)/gim)].map((match) => match[1]!);
}

/** Count exact source occurrences without interpreting regular-expression syntax. */
export function countLiteral(source: string, literal: string): number {
  return source.split(literal).length - 1;
}
