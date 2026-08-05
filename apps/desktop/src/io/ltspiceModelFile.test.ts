import { describe, it, expect } from "vitest";
import {
  installedLibraryFileCandidates,
  ltspiceModelFileFromSymbolAttrs,
} from "./ltspiceModelFile";

describe("installedLibraryFileCandidates", () => {
  it("lists authored path then same-stem .sub/.lib/.mod siblings", () => {
    expect(installedLibraryFileCandidates("AD4000.sub")).toEqual([
      "AD4000.sub",
      "AD4000.lib",
      "AD4000.mod",
    ]);
  });

  it("returns the authored token alone when it has no library suffix", () => {
    expect(installedLibraryFileCandidates("UniversalOpAmp2")).toEqual(["UniversalOpAmp2"]);
  });
});

describe("ltspiceModelFileFromSymbolAttrs", () => {
  it("prefers ModelFile over SpiceModel", () => {
    expect(ltspiceModelFileFromSymbolAttrs({
      ModelFile: "AD4000.sub",
      SpiceModel: "AD4000",
    })).toBe("AD4000.sub");
  });

  it("uses SpiceModel only when it looks like a library file", () => {
    expect(ltspiceModelFileFromSymbolAttrs({ SpiceModel: "ADM7150_1.sub" })).toBe("ADM7150_1.sub");
    expect(ltspiceModelFileFromSymbolAttrs({ SpiceModel: "level.2" })).toBeUndefined();
  });
});
