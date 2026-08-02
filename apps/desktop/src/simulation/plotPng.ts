/** Raster export for the SVG waveform panes shown in the simulator. */

const INLINE_STYLE_PROPERTIES = [
  "color",
  "fill",
  "fill-opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
] as const;

interface SvgSize {
  width: number;
  height: number;
}

function svgSize(svg: SVGSVGElement): SvgSize {
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] };
  }
  const rect = svg.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
  throw new Error("A waveform pane has no exportable size.");
}

/** Clone an SVG with every rendered paint/font property inlined. The clone no
 * longer depends on App.css or theme selectors when loaded as a standalone image. */
export function standaloneSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const sources = [svg, ...Array.from(svg.querySelectorAll<SVGElement>("*"))];
  const targets = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];
  for (let index = 0; index < sources.length; index += 1) {
    const computed = getComputedStyle(sources[index]);
    const target = targets[index];
    for (const property of INLINE_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  }
  return new XMLSerializer().serializeToString(clone);
}

function loadSvgImage(svg: SVGSVGElement): Promise<{ image: HTMLImageElement; url: string }> {
  const blob = new Blob([standaloneSvg(svg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The waveform SVG could not be rasterized."));
    };
    image.src = url;
  });
}

/** Render every visible waveform SVG into one two-column PNG. This preserves
 * multi-pane dashboards rather than silently exporting only the first trace. */
export async function waveformSvgsToPng(
  svgs: readonly SVGSVGElement[],
  scale = 2,
): Promise<Blob> {
  if (svgs.length === 0) throw new Error("There are no waveform panes to export.");
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("PNG export scale must be positive.");

  const sizes = svgs.map(svgSize);
  const columns = Math.min(2, svgs.length);
  const rows = Math.ceil(svgs.length / columns);
  const cellWidth = Math.max(...sizes.map((size) => size.width));
  const cellHeight = Math.max(...sizes.map((size) => size.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(columns * cellWidth * scale);
  canvas.height = Math.ceil(rows * cellHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This system cannot create a PNG canvas.");
  context.scale(scale, scale);

  const background = getComputedStyle(document.documentElement).getPropertyValue("--panel-3").trim()
    || getComputedStyle(svgs[0]).backgroundColor;
  if (background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)") {
    context.fillStyle = background;
    context.fillRect(0, 0, columns * cellWidth, rows * cellHeight);
  }

  for (let index = 0; index < svgs.length; index += 1) {
    const { image, url } = await loadSvgImage(svgs[index]);
    try {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const size = sizes[index];
      context.drawImage(image, column * cellWidth, row * cellHeight, size.width, size.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The waveform canvas could not be encoded as PNG."));
    }, "image/png");
  });
}

/** Download a PNG blob with Tau's dated export naming convention. */
export function downloadWaveformPng(blob: Blob, tag = "transient"): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `tau-${tag}-${new Date().toISOString().slice(0, 10)}.png`;
  anchor.click();
  URL.revokeObjectURL(url);
}
