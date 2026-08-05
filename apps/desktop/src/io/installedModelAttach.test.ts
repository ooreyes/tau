import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  nestedLibraryFileRefs,
  attachedInstalledModelLibraryTexts,
} from "./installedModelAttach";

describe("installedModelAttach", () => {
  it("lists nested .lib / .include refs from library text", () => {
    expect(nestedLibraryFileRefs(".subckt X 1 2\n.lib UniversalOpAmp2.lib\n.ends X\n"))
      .toEqual(["UniversalOpAmp2.lib"]);
    expect(nestedLibraryFileRefs(".include peer.sub\n.inc nested.mod\n"))
      .toEqual(["peer.sub", "nested.mod"]);
  });

  it("attaches nested UniversalOpAmp2 peers so level2 resolves", () => {
    const root = mkdtempSync(join(tmpdir(), "tau-nested-lib-"));
    try {
      mkdirSync(join(root, "sub"), { recursive: true });
      writeFileSync(
        join(root, "sub", "AD8310.lib"),
        [
          ".subckt AD8310 1 2 3 4 5 6 7 8",
          "XU1 1 2 3 4 5 level2 Avol=1Meg",
          ".lib UniversalOpAmp2.lib",
          ".ends AD8310",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(root, "sub", "UniversalOpAmp2.lib"),
        ".subckt level2 1 2 3 4 5\nE1 5 0 1 2 1Meg\n.ends level2\n",
      );
      const texts = attachedInstalledModelLibraryTexts(["AD8310.lib"], [root]);
      expect(texts).toHaveLength(2);
      expect(texts[0]).toContain(".subckt AD8310");
      expect(texts[1]).toContain(".subckt level2");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
