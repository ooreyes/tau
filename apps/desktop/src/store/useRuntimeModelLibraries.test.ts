import { describe, expect, it } from "vitest";

import { installedLtspiceStandardModelFiles } from "./useRuntimeModelLibraries";

describe("installedLtspiceStandardModelFiles", () => {
  it("selects only LTspice's four implicit standard-device databases", () => {
    const files = [
      { name: "standard.dio", id: "cmp/standard.dio" },
      { name: "STANDARD.BJT", id: "cmp/standard.bjt" },
      { name: "standard.mos", id: "cmp/standard.mos" },
      { name: "standard.jft", id: "cmp/standard.jft" },
      { name: "LTC.lib", id: "sub/LTC.lib" },
      { name: "standard.res", id: "cmp/standard.res" },
      { name: "custom.mod", id: "cmp/custom.mod" },
    ];

    expect(installedLtspiceStandardModelFiles(files).map((file) => file.id)).toEqual([
      "cmp/standard.dio",
      "cmp/standard.bjt",
      "cmp/standard.mos",
      "cmp/standard.jft",
    ]);
  });
});
