import { describe, expect, it } from "vitest";
import {
  classifyExternalEdit,
  diskContentFingerprint,
  externalEditDialogBody,
  externalEditDialogTitle,
} from "./externalEditConflict";

describe("diskContentFingerprint", () => {
  it("is stable for identical contents", () => {
    expect(diskContentFingerprint("Version 4\n")).toBe(diskContentFingerprint("Version 4\n"));
  });

  it("changes when a single character changes", () => {
    expect(diskContentFingerprint("Version 4\n")).not.toBe(diskContentFingerprint("Version 5\n"));
  });

  it("changes when length changes with a colliding-prone prefix", () => {
    expect(diskContentFingerprint("aa")).not.toBe(diskContentFingerprint("aaa"));
  });
});

describe("classifyExternalEdit", () => {
  const synced = diskContentFingerprint("saved");

  it("reports in-sync when disk matches the synced fingerprint", () => {
    expect(classifyExternalEdit({
      syncedFingerprint: synced,
      diskFingerprint: synced,
      editorDirty: true,
    })).toEqual({ kind: "in-sync", diskFingerprint: synced });
  });

  it("reports external-only when disk changed and the editor is clean", () => {
    const disk = diskContentFingerprint("external");
    expect(classifyExternalEdit({
      syncedFingerprint: synced,
      diskFingerprint: disk,
      editorDirty: false,
    })).toEqual({ kind: "external-only", diskFingerprint: disk });
  });

  it("reports conflict when disk changed and the editor is dirty", () => {
    const disk = diskContentFingerprint("external");
    expect(classifyExternalEdit({
      syncedFingerprint: synced,
      diskFingerprint: disk,
      editorDirty: true,
    })).toEqual({ kind: "conflict", diskFingerprint: disk });
  });

  it("reports missing when the path no longer exists", () => {
    expect(classifyExternalEdit({
      syncedFingerprint: synced,
      diskFingerprint: null,
      editorDirty: false,
    })).toEqual({ kind: "missing", diskFingerprint: null });
  });
});

describe("externalEditDialog copy", () => {
  it("names the conflict and keeps overwrite honest", () => {
    expect(externalEditDialogTitle("conflict")).toBe("File conflict");
    expect(externalEditDialogBody("conflict", "buck.asc")).toMatch(/buck\.asc/);
    expect(externalEditDialogBody("conflict", "buck.asc")).toMatch(/overwrite disk on Save/);
  });

  it("explains external-only reload vs keep", () => {
    expect(externalEditDialogTitle("external-only")).toBe("File changed on disk");
    expect(externalEditDialogBody("external-only", "tank.asc")).toMatch(/modified outside Tau/);
  });

  it("explains a missing file without implying silent recreate", () => {
    expect(externalEditDialogTitle("missing")).toBe("File missing on disk");
    expect(externalEditDialogBody("missing", "gone.asc")).toMatch(/Detaches|detaches|Keep open/i);
  });
});
