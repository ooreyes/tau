// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { standaloneSvg, waveformSvgsToPng } from "./plotPng";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function svg(label: string): SVGSVGElement {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  element.setAttribute("viewBox", "0 0 340 210");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("aria-label", label);
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("d", "M 0 0 L 10 10");
  element.append(path);
  document.body.append(element);
  return element;
}

describe("PNG waveform export", () => {
  it("serializes a standalone SVG with rendered styles and namespace", () => {
    const output = standaloneSvg(svg("out"));
    expect(output).toContain("xmlns=\"http://www.w3.org/2000/svg\"");
    expect(output).toContain("aria-label=\"out\"");
    expect(output).toContain("stroke:");
  });

  it("draws every pane into one two-column, 2x PNG", async () => {
    const drawImage = vi.fn();
    const context = {
      scale: vi.fn(),
      fillRect: vi.fn(),
      drawImage,
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:waveform"),
      revokeObjectURL: vi.fn(),
    });
    class LoadedImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", LoadedImage);

    const blob = await waveformSvgsToPng([svg("one"), svg("two"), svg("three")]);
    const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
    // The helper's canvas is detached, so dimensions are proven via draw slots:
    // pane 1 (0,0), pane 2 (340,0), pane 3 (0,210).
    expect(canvas).toBeNull();
    expect(drawImage).toHaveBeenCalledTimes(3);
    expect(drawImage.mock.calls.map((call) => call.slice(1))).toEqual([
      [0, 0, 340, 210],
      [340, 0, 340, 210],
      [0, 210, 340, 210],
    ]);
    expect(blob.type).toBe("image/png");
  });
});
