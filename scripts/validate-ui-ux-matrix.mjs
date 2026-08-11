#!/usr/bin/env node

/** Validate the packaged native UI/UX acceptance matrix and interaction map. */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const manifestPath = path.resolve(root, process.argv[2] ?? "screenshots/ui-ux-fixes/native/matrix-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const themes = ["light", "dark"];
const viewports = ["900x600", "1280x800", "1440x900"];
const states = ["empty", "populated", "selected", "properties", "simulator"];
const expectedKeys = new Set(
  themes.flatMap((theme) => viewports.flatMap((viewport) => states.map((state) => `${theme}|${viewport}|${state}`))),
);

function fail(message) {
  console.error(`UI-UX-MATRIX: FAIL: ${message}`);
  process.exit(1);
}

function imageDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length >= 24
    && bytes.readUInt32BE(0) === 0x89504e47
    && bytes.readUInt32BE(4) === 0x0d0a1a0a) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  // The native screenshot pipeline keeps JPEG payloads under its historical
  // `.png` names. Read SOF markers instead of trusting the extension.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail(`unsupported image format: ${filePath}`);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (offset + 7 > bytes.length) break;
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  fail(`could not read image dimensions: ${filePath}`);
}

if (manifest.schema !== "tau.ui-ux.native-matrix.v1") fail(`unexpected schema ${manifest.schema}`);
if (!Array.isArray(manifest.entries) || manifest.entries.length !== expectedKeys.size) {
  fail(`expected ${expectedKeys.size} matrix entries, got ${manifest.entries?.length ?? 0}`);
}

const seen = new Set();
for (const entry of manifest.entries) {
  const { theme, viewport, state, path: relativePath, capturePixels, assertions } = entry;
  if (!themes.includes(theme) || !viewports.includes(viewport) || !states.includes(state)) {
    fail(`invalid matrix key fields: ${JSON.stringify({ theme, viewport, state })}`);
  }
  const key = `${theme}|${viewport}|${state}`;
  if (seen.has(key)) fail(`duplicate matrix key ${key}`);
  seen.add(key);
  if (!expectedKeys.has(key)) fail(`unexpected matrix key ${key}`);
  if (typeof relativePath !== "string" || !relativePath.startsWith("screenshots/ui-ux-fixes/native/")) {
    fail(`${key} is outside the committed native evidence directory`);
  }
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) fail(`${key} is missing ${relativePath}`);
  const dimensions = imageDimensions(absolutePath);
  if (`${dimensions.width}x${dimensions.height}` !== capturePixels) {
    fail(`${key} declares ${capturePixels} but measures ${dimensions.width}x${dimensions.height}`);
  }
  if (!Array.isArray(assertions) || assertions.length === 0) fail(`${key} has no measured assertions`);
}
for (const key of expectedKeys) if (!seen.has(key)) fail(`missing matrix key ${key}`);

const expectedComponents = {
  "COMP-03": "isource",
  "COMP-06": "inspector",
  "COMP-11": "model-recovery",
  "COMP-12": "pulse",
  "COMP-15": "seven-segment",
  "COMP-16": "seven-segment",
};
if (!Array.isArray(manifest.issueArtifacts)) fail("issueArtifacts is missing");
const mappedIssues = new Set();
for (const artifact of manifest.issueArtifacts) {
  if (!Array.isArray(artifact.issueIds) || typeof artifact.path !== "string") fail("malformed issue artifact");
  const absolutePath = path.join(root, artifact.path);
  if (!fs.existsSync(absolutePath)) fail(`missing issue artifact ${artifact.path}`);
  if (!Array.isArray(artifact.assertions) || artifact.assertions.length === 0) fail(`issue artifact has no assertions: ${artifact.path}`);
  for (const issueId of artifact.issueIds) {
    mappedIssues.add(issueId);
    const expectedComponent = expectedComponents[issueId];
    if (expectedComponent && artifact.component !== expectedComponent) {
      fail(`${issueId} points at component ${artifact.component ?? "none"}, expected ${expectedComponent}`);
    }
  }
}
for (const issueId of Object.keys(expectedComponents)) if (!mappedIssues.has(issueId)) fail(`${issueId} has no interaction artifact`);

console.log(`UI-UX-MATRIX: PASS: ${seen.size}/${expectedKeys.size} keys; ${manifest.issueArtifacts.length} interaction artifacts; all files and dimensions verified`);
