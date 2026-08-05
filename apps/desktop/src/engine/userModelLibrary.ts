/**
 * Parse USER-PROVIDED vendor `.lib`/`.subckt`/`.mod` file text into a lookup
 * registry (LTspice parity gap): a component may reference a model or
 * subcircuit name that is neither inline in the document, nor one of Tau's
 * bundled parts (standardModels.ts's standard.dio/bjt/jft parts,
 * bundledSubcircuits.ts's library subcircuits). Without this there is
 * nowhere to get the real definition and an explicitly named device must
 * refuse rather than fall back to a generic `TAU_*` starter model.
 *
 * The native engine's deck sanitizer (src-tauri/src/spice.rs `deck_lines`)
 * REJECTS file-backed primitives (`.include`, `.lib`, `file=`, `filename=`,
 * `pwl(file...)`), so a matched definition can only ever reach the deck by
 * INLINING its literal text - this module's entire purpose is producing that
 * literal text; it never returns a path or a `.include`/`.lib` reference.
 *
 * Recursion note: an `.include`/`.lib` line found INSIDE a supplied library
 * text is ignored here rather than followed - `importProjectAsc` resolves
 * nested file refs at attach time (same confined roots) and registers each
 * peer as its own library entry. This parser only ever inlines literal text;
 * following a path would reintroduce file-backed cards the sanitizer rejects.
 *
 * Pure and dependency-light: no filesystem access, no schematic knowledge -
 * just text in, a registry out.
 */

import { parseQuantity } from "../simulation/quantity";
import { sanitizeSubcktName } from "./bundledSubcircuits";
import { ifToTernary, ltFuncsToNgspice } from "../simulation/behavioral";

export interface UserModelLibraryRegistry {
  /** Model name (lower-cased) -> its full `.model` line, with any `+`
   *  continuation lines collapsed into one ngspice-valid logical line. */
  readonly models: ReadonlyMap<string, string>;
  /** Sanitized subckt name (lower-cased, via {@link sanitizeSubcktName}) ->
   *  its full `.subckt … .ends` block. The interior is preserved as the vendor
   *  wrote it except for the LTspice-only constructs ngspice rejects, which are
   *  rewritten in place (see {@link normalizeSubcktInterior}); everything
   *  ngspice already accepts stays byte-for-byte. */
  readonly subckts: ReadonlyMap<string, string>;
}

/** Strip a SPICE end-of-line `;` comment. Matches the convention already used
 *  for directive lines elsewhere (paramScope.ts's `expandDirectiveLines`) -
 *  no quote-awareness; `;` always starts a comment running to end of line. */
function stripTrailingComment(line: string): string {
  const semi = line.indexOf(";");
  return (semi >= 0 ? line.slice(0, semi) : line).trim();
}

/**
 * Drop LTspice/vendor annotation parameters whose value is a bare word
 * (`mfg=NXP`, `mfg=STMicro`, `type=Sic`, …). ngspice FATALLY rejects a `.model`
 * parameter with a non-numeric value ("Error in netlist line …"), which sinks
 * the whole deck; but a genuine device-model parameter always begins with a
 * digit, sign, or decimal point, so a value that starts with a letter is always
 * datasheet metadata, never a simulation parameter. Only those letter-valued
 * assignments are removed - the model name and type, bare flags (`pchan`),
 * every numeric parameter, and the numeric annotations ngspice merely warns
 * about and ignores (`Vceo=60`, `Icrating=10`) are all left untouched, since
 * dropping a parameter by name could silently discard a real one. Tau already
 * hand-removes these keys when curating its bundled models (standardModels.ts);
 * this does the same for user-imported files.
 */
function stripAnnotationParams(line: string): string {
  return line
    .replace(/(?<=[\s(])[A-Za-z_][\w.]*\s*=\s*[A-Za-z][^\s()]*/g, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Remove LTspice's bare `noiseless` device flag. ngspice has no such keyword:
 * on an R/C/L INSTANCE line it is read as an unknown model/parameter and
 * FATALLY aborts the whole deck ("unknown parameter (noiseless)" -> "incomplete
 * or empty netlist"), while inside a `.model` card ngspice merely warns and
 * ignores it. Vendor macromodels (Analog Devices' among them) tag every
 * internal passive `noiseless`, so a single unstripped flag on an instance line
 * sinks the entire imported part - a real ADI op-amp like ADA4351 (140 such
 * flags) goes from an empty netlist to a full operating point once they are
 * gone. The token is matched whole-word and case-insensitively; the whitespace
 * it leaves behind is collapsed (leading indentation preserved) so the emitted
 * card stays clean.
 */
function stripNoiselessFlag(line: string): string {
  if (!/\bnoiseless\b/i.test(line)) return line;
  const lead = /^[ \t]*/.exec(line)?.[0] ?? "";
  const body = line
    .slice(lead.length)
    .replace(/\bnoiseless\b/gi, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/g, "");
  return lead + body;
}

const LTSPICE_PI = "3.141592653589793";
const LTSPICE_IDEAL_DIODE_KEYS = /\b(?:ron|roff|vfwd|vrev|rrev|ilimit|revilimit|epsilon|revepsilon)\s*=/i;
export const TAU_MODEL_REFUSAL_MARKER = "* TAU_MODEL_REFUSAL: ";
export const TAU_NOISE_REFUSAL_MARKER = "* TAU_NOISE_REFUSAL: ";

function replaceLtspiceConstants(line: string): string {
  return line.replace(/\bpi\b/gi, LTSPICE_PI);
}

function modelParamMap(text: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const match of text.matchAll(/([A-Za-z_]\w*)\s*=\s*(\{[^}]*\}|[^\s]+)/g)) {
    params.set(match[1].toLowerCase(), match[2]);
  }
  return params;
}

function finiteLiteral(value: string | undefined): number | null {
  if (value === undefined || /[{}A-DF-Za-df-z_]/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** LTspice's piecewise-linear diode and ngspice's bundled `sidiode` code
 * model implement the same Ron/Roff/Vfwd/Vrev/Rrev/current-limit/quadratic-
 * shoulder contract. Rename the model type and its instances; do not feed the
 * parameters to ngspice's unrelated Berkeley diode and accept its warnings. */
function translateIdealDiodes(lines: string[]): string[] {
  const usedModelNames = new Set<string>();
  for (const line of lines) {
    const name = /^\s*\.model\s+(\S+)/i.exec(line)?.[1];
    if (name) usedModelNames.add(name.toLowerCase());
  }
  const idealModels = new Map<string, string>();
  for (const line of lines) {
    const match = /^\s*\.model\s+(\S+)\s+D\s*\((.*)\)\s*$/i.exec(line);
    if (!match || !LTSPICE_IDEAL_DIODE_KEYS.test(match[2])) continue;
    const original = match[1];
    let emitted = original;
    // XSPICE model identifiers must start with a name character. LTspice
    // permits numeric names such as `2p`; bind those to a private safe name
    // while leaving valid vendor identities byte-for-byte.
    if (!/^[A-Za-z_][A-Za-z0-9_.$]*$/.test(original)) {
      const base = `__tau_sidiode_${original.replace(/[^A-Za-z0-9_]/g, "_") || "model"}`;
      emitted = base;
      let suffix = 2;
      while (usedModelNames.has(emitted.toLowerCase())) emitted = `${base}_${suffix++}`;
      usedModelNames.add(emitted.toLowerCase());
    }
    idealModels.set(original.toLowerCase(), emitted);
  }
  return lines.map((line) => {
    const model = /^\s*\.model\s+(\S+)\s+D\s*\((.*)\)\s*$/i.exec(line);
    const emittedModel = model ? idealModels.get(model[1].toLowerCase()) : undefined;
    if (model && emittedModel) {
      return `.model ${emittedModel} sidiode(${stripNoiselessFlag(model[2]).trim()})`;
    }
    const device = /^\s*(D\S+)\s+(\S+)\s+(\S+)\s+(\S+)(.*)$/i.exec(line);
    const emittedDeviceModel = device ? idealModels.get(device[4].toLowerCase()) : undefined;
    if (!device || !emittedDeviceModel) return line;
    if (device[5].trim() !== "") {
      return `${TAU_MODEL_REFUSAL_MARKER}${device[1]} uses LTspice ideal-diode instance options Tau cannot map exactly.`;
    }
    return `A__tau_${device[1]} ${device[2]} ${device[3]} ${emittedDeviceModel}`;
  });
}

function instanceParameter(tail: string, name: "rser" | "rpar" | "cpar" | "m"): string | null {
  return new RegExp(`\\b${name}\\s*=\\s*(\\{[^}]*\\}|[^\\s]+)`, "i").exec(tail)?.[1] ?? null;
}

function withoutInstanceParameters(tail: string, names: readonly ("rser" | "rpar" | "cpar")[]): string {
  let remaining = tail;
  for (const name of names) {
    remaining = remaining.replace(new RegExp(`\\s+${name}\\s*=\\s*(?:\\{[^}]*\\}|[^\\s]+)`, "ig"), "");
  }
  return remaining.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/g, "");
}

function isLiteralZero(value: string | null): boolean {
  if (value === null || value.includes("{")) return false;
  try {
    return parseQuantity(value) === 0;
  } catch {
    return false;
  }
}

/**
 * LTspice's C/L devices accept Rser/Rpar/Cpar instance parasitics that ngspice
 * either rejects or only partly implements. Expand the documented equivalent
 * circuits explicitly: Rser is in series with the named reactive element,
 * while Rpar and Cpar span the original two terminals. The original C/L name
 * remains on the reactive element so current probes and K-coupling identities
 * do not change. Parameter expressions remain literal subcircuit expressions.
 */
function translatePassiveParasitics(line: string, subcktName: string): string[] {
  const passive = /^(\s*)([CL]\S+)\s+(\S+)\s+(\S+)\s+(\S+)(.*)$/i.exec(line);
  if (!passive) return [line];
  const [, indent, instance, positive, negative, value, tail] = passive;
  const rser = instanceParameter(tail, "rser");
  const rpar = instanceParameter(tail, "rpar");
  const cpar = instanceParameter(tail, "cpar");
  if (rser === null && rpar === null && cpar === null) return [line];

  if (instanceParameter(tail, "m") !== null) {
    return [`${TAU_MODEL_REFUSAL_MARKER}${subcktName}/${instance} combines m= with LTspice parasitics; Tau cannot preserve per-unit scaling exactly yet.`];
  }

  const remainingTail = withoutInstanceParameters(tail, ["rser", "rpar", "cpar"]);
  const safe = `${subcktName}_${instance}`.replace(/[^A-Za-z0-9_]/g, "_");
  const hasSeriesResistance = rser !== null && !isLiteralZero(rser);
  const reactivePositive = hasSeriesResistance
    ? `__tau_${instance[0].toLowerCase()}ser_${safe}`
    : positive;
  const translated = [
    `${indent}${instance} ${reactivePositive} ${negative} ${value}${remainingTail}`,
  ];
  if (hasSeriesResistance) {
    translated.push(`${indent}R__tau_rser_${safe} ${positive} ${reactivePositive} ${rser}`);
  }
  if (rpar !== null) translated.push(`${indent}R__tau_rpar_${safe} ${positive} ${negative} ${rpar}`);
  if (cpar !== null) translated.push(`${indent}C__tau_cpar_${safe} ${positive} ${negative} ${cpar}`);
  return translated;
}

/** LTspice accepts the diode area as a bare positional token. ngspice accepts
 * that form at top level but, inside a subcircuit with a local `.model`, folds
 * the token into a malformed doubly-scoped model identity (`x1.x1:model`). Its
 * documented `area=<value>` spelling is electrically identical and unambiguous.
 */
function translateDiodeArea(line: string): string {
  const diode = /^(\s*D\S*\s+\S+\s+\S+\s+\S+)\s+(\{[^}]*\}|\S+)(.*)$/i.exec(line);
  if (!diode) return line;
  const token = diode[2];
  // No positional area: the first token is already a keyword option/flag.
  if (token.includes("=") || /^(?:off|on)$/i.test(token)) return line;
  return `${diode[1]} area=${token}${diode[3]}`;
}

/**
 * LTspice's undocumented `dir`/`vto` extension on a linear G source is a
 * one-sided square-law transconductor. Measured against LTspice 17.2.4:
 *   I = dir * gain * max(dir * (V(control) - vto), 0)^2
 * Emit that exact transfer as a behavioral current source. Unknown directions,
 * missing pairs, or extra bare options refuse instead of becoming a linear G.
 */
function translateDirectedG(line: string, subcktName: string): string {
  const source = /^(\s*)(G\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(.*)$/i.exec(line);
  if (!source) return line;
  const [, indent, instance, outPositive, outNegative, controlPositive, controlNegative, gain, tail] = source;
  const params = modelParamMap(tail);
  const hasDirectedOption = params.has("dir") || params.has("vto");
  if (!hasDirectedOption) return line;
  const remaining = tail
    .replace(/\s+(?:dir|vto)\s*=\s*(?:\{[^}]*\}|\S+)/gi, "")
    .trim();
  const direction = Number(params.get("dir"));
  const vto = params.get("vto");
  if ((direction !== 1 && direction !== -1) || vto === undefined || remaining !== "") {
    return `${TAU_MODEL_REFUSAL_MARKER}${subcktName}/${instance} uses LTspice directed-G options Tau cannot map exactly.`;
  }
  const drive = `V(${controlPositive},${controlNegative})-(${vto})`;
  const current = direction === 1
    ? `(${drive})>0 ? (${gain})*(${drive})*(${drive}) : 0`
    : `(${drive})<0 ? -(${gain})*(${drive})*(${drive}) : 0`;
  return `${indent}B__tau_${instance} ${outPositive} ${outNegative} I={${current}}`;
}

/** LTspice's `load` flag makes an independent current source dissipative.
 * Tau's transfer was measured against LTspice 17.2.4: for normalized current
 * it is `4V` at V<=0, `4V-4V²` from 0..0.5 V, and 1 above 0.5 V. This also
 * matches LTspice's documented zero-voltage resistance (0.25 V / I), bend
 * point, and high-voltage current. ngspice otherwise rejects the bare flag. */
function translateDissipativeCurrentLoad(line: string): string {
  const source = /^(\s*)(I\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+load\s*$/i.exec(line);
  if (!source) return line;
  const safe = source[2].replace(/[^A-Za-z0-9_]/g, "_");
  const voltage = `V(${source[3]},${source[4]})`;
  return `${source[1]}B__tau_load_${safe} ${source[3]} ${source[4]} I={(${source[5]})*(${voltage}<=0 ? 4*${voltage} : ${voltage}<0.5 ? 4*${voltage}-4*${voltage}*${voltage} : 1)}`;
}

/** Map the documented LTspice OTA subset used by current vendor op-amp
 * libraries onto Tau's pinned native OTA code model. Multiplying ports must be
 * tied off and voltage compliance must be explicitly infinite. Asymmetric
 * Isource/Isink (`asym`) and input `Ref` offset map onto the patched OTA
 * (tanh current limit + series offset). `linear`, `rclamp`, and `epsilon`
 * still refuse — they change the transfer or compliance shape. Cout/Rout
 * remain literal passive elements across LTspice's output/common pins. */
function translateLtspiceOta(line: string, subcktName: string): string[] {
  const match = /^\s*(A\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+OTA\b(.*)$/i.exec(line);
  if (!match) return [line];
  const [, instance, inp, inn, mul1p, mul1n, mul2p, mul2n, out, common, tail] = match;
  const params = modelParamMap(tail);
  const refusal = (reason: string) => [`${TAU_MODEL_REFUSAL_MARKER}${subcktName}/${instance} ${reason}`];

  if (mul1p.toLowerCase() !== mul1n.toLowerCase() || mul2p.toLowerCase() !== mul2n.toLowerCase()) {
    return refusal("uses active four-quadrant multiplier ports; the native two-port OTA is not equivalent.");
  }
  if (/\blinear\b/i.test(tail)) {
    return refusal("uses LTspice OTA 'linear' hard-clip transfer; Tau's tanh Iout limit is not equivalent.");
  }
  if (params.has("rclamp") || params.has("epsilon")) {
    return refusal("uses OTA voltage-compliance shaping (rclamp/epsilon) not mapped exactly.");
  }

  const isource = params.get("isource") ?? params.get("isrc");
  const isink = params.get("isink");
  const wantsAsym = /\basym\b/i.test(tail) || isource !== undefined || isink !== undefined;
  if (wantsAsym && (isource === undefined || isink === undefined)) {
    return refusal("uses asymmetric OTA current limits without both Isource and Isink; refusing rather than guessing a symmetric Iout.");
  }

  const gm = params.get("g") ?? "1";
  const gmLiteral = finiteLiteral(gm);
  const inactiveOutput = gmLiteral === 0 && out.toLowerCase() === common.toLowerCase();
  const vhigh = finiteLiteral(params.get("vhigh"));
  const vlow = finiteLiteral(params.get("vlow"));
  if (!inactiveOutput && (vhigh === null || vlow === null || vhigh < 1e100 || vlow > -1e100)) {
    return refusal("uses finite or implicit voltage compliance; substituting an unclamped OTA would be inaccurate.");
  }

  const safe = `${subcktName}_${instance}`.replace(/[^A-Za-z0-9_]/g, "_");
  const model = `__tau_ota_${safe}`;
  const sink = `__tau_ota_sink_${safe}`;
  const sensor = `V__tau_ota_${safe}`;
  const modelParams = [`gm=${gm}`, "rout=1e308", "rin=1e308"];
  if (wantsAsym && isource !== undefined && isink !== undefined) {
    modelParams.push(`isource=${isource}`, `isink=${isink}`);
  } else {
    modelParams.push(`iout=${params.get("iout") ?? "10u"}`);
  }
  const simpleNoise = [
    ["en", "en"], ["enk", "enk"], ["in", "in_noise"],
    ["ink", "ink"], ["incm", "incm"], ["incmk", "incmk"],
  ] as const;
  const noiseRefusals: string[] = [];
  for (const [ltName, ngName] of simpleNoise) {
    const value = params.get(ltName);
    if (!value) continue;
    if (/\bfreq\b/i.test(value)) noiseRefusals.push(`${ltName} is frequency-dependent`);
    else modelParams.push(`${ngName}=${value}`);
  }

  const translated: string[] = [`.model ${model} ota(${modelParams.join(" ")})`];
  let innNode = inn;
  const ref = params.get("ref");
  if (ref !== undefined) {
    // LTspice: I = f(gm*(V(in+)-V(in-)-Ref)). Raise inn by Ref so the
    // differential seen by the two-port OTA matches that offset exactly.
    const refNode = `__tau_ota_ref_${safe}`;
    translated.push(`V__tau_ota_ref_${safe} ${refNode} ${inn} ${ref}`);
    innNode = refNode;
  }
  translated.push(
    `A__tau_ota_${safe} ${inp} ${innNode} ${sink} ${model}`,
    `${sensor} ${sink} 0 0`,
    `F__tau_ota_${safe} ${out} ${common} ${sensor} 1`,
  );
  const cout = params.get("cout");
  if (cout && finiteLiteral(cout) !== 0) translated.push(`C__tau_ota_${safe} ${out} ${common} ${cout}`);
  const rout = params.get("rout");
  if (rout && (finiteLiteral(rout) === null || (finiteLiteral(rout) ?? 0) < 1e100)) {
    translated.push(`R__tau_ota_${safe} ${out} ${common} ${rout}`);
  }
  if (noiseRefusals.length > 0) {
    translated.push(`${TAU_NOISE_REFUSAL_MARKER}${subcktName}/${instance}: ${noiseRefusals.join(", ")}.`);
  }
  return translated;
}

/** Emit a computed switch threshold as a clean deck token: strip the binary
 *  float noise that `(Von+Voff)/2` produces (`0.3500000000000001`) while
 *  keeping every significant digit a real threshold carries. */
function formatSwitchLevel(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/**
 * Translate an LTspice switch `.model` card into the ngspice spelling. LTspice's
 * `VSWITCH`/`ISWITCH` (voltage- and current-controlled) are `SW`/`CSW` in
 * ngspice, and the threshold pair is stated differently: LTspice gives the on
 * and off control levels directly (`Von`/`Voff`, `Ion`/`Ioff`), ngspice gives a
 * center threshold plus a hysteresis half-width (`Vt`/`Vh`, `It`/`Ih`). A bare
 * rename is NOT enough - ngspice reads `von`/`voff` on an `SW` card as unknown
 * parameters and silently ignores them, leaving `Vt=Vh=0` (the switch then
 * trips at zero, not the vendor's level), so the levels must be converted:
 *   Vt = (Von + Voff) / 2,  Vh = (Von - Voff) / 2   (and likewise It/Ih).
 * `Ron`/`Roff` carry across unchanged and are re-emitted as their original
 * strings, so no SPICE suffix or precision is lost. Any bare flag in the body
 * that is not a switch parameter - notably LTspice's `noiseless` - is dropped,
 * since only the four recognized keys are re-emitted.
 *
 * A line that is not a switch `.model`, or whose `vswitch(...)`/`iswitch(...)`
 * body cannot be matched (e.g. a `+` continuation split the parentheses across
 * lines), is returned UNCHANGED - the caller then inlines it as the vendor
 * wrote it, exactly as before, rather than risk emitting a malformed card.
 */
export function translateSwitchModelCard(line: string): string {
  const match = /^\s*\.model\s+(\S+)\s+(vswitch|iswitch)\s*\(([^()]*)\)/i.exec(line);
  if (!match) return line;
  const [, name, kind, body] = match;
  const isVoltage = kind.toLowerCase() === "vswitch";

  // key -> raw value string, from `key=value` pairs (comma OR whitespace
  // separated). Bare tokens (e.g. `noiseless`) have no `=` and are skipped.
  const params = new Map<string, string>();
  for (const pair of body.matchAll(/([A-Za-z_]\w*)\s*=\s*([^\s,()]+)/g)) {
    params.set(pair[1].toLowerCase(), pair[2]);
  }

  const on = params.get(isVoltage ? "von" : "ion");
  const off = params.get(isVoltage ? "voff" : "ioff");
  const ron = params.get("ron");
  const roff = params.get("roff");

  const out: string[] = [];
  if (ron !== undefined) out.push(`RON=${ron}`);
  if (roff !== undefined) out.push(`ROFF=${roff}`);
  if (on !== undefined && off !== undefined) {
    let onVal: number;
    let offVal: number;
    try {
      onVal = parseQuantity(on);
      offVal = parseQuantity(off);
    } catch {
      return line; // an unparseable threshold: leave the whole card untouched.
    }
    const tKey = isVoltage ? "VT" : "IT";
    const hKey = isVoltage ? "VH" : "IH";
    out.push(`${tKey}=${formatSwitchLevel((onVal + offVal) / 2)}`);
    out.push(`${hKey}=${formatSwitchLevel((onVal - offVal) / 2)}`);
  }

  return `.model ${name} ${isVoltage ? "SW" : "CSW"}(${out.join(" ")})`;
}

/**
 * Rewrite the LTspice-only constructs inside a captured `.subckt` block that
 * ngspice's build rejects, so an inlined vendor macromodel actually simulates.
 * The transform is deliberately SURGICAL and line-gated - every line ngspice
 * already accepts passes through byte-for-byte; only these constructs change:
 *   - a switch `.model` card (`VSWITCH`/`ISWITCH`), via
 *     {@link translateSwitchModelCard};
 *   - a voltage-switch instance (`Sxxx n+ n- (nc+,nc-) MODEL`), whose control
 *     nodes LTspice wraps in parentheses - ngspice wants them bare, so the
 *     parentheses are removed and any comma inside becomes a space. Current
 *     switches (`Wxxx n+ n- Vsource MODEL`) name their control source and carry
 *     no such parentheses, so they are left alone;
 *   - a bare `noiseless` device flag on any instance or `.model` line, via
 *     {@link stripNoiselessFlag} - fatal on an instance line, so it must go.
 * Full-line comments (`*`/`;`) are left untouched. Everything else (transistor
 * models, POLY sources, passives) is already valid ngspice and stays exactly as
 * the vendor wrote it.
 */
function normalizeSubcktInterior(block: string): string {
  const subcktName = /^\s*\.subckt\s+(\S+)/im.exec(block)?.[1] ?? "vendor-subckt";
  const normalized = block
    .split("\n")
    .flatMap((line) => {
      if (/^\s*[*;]/.test(line)) return line;
      // A nested file reference is never followed: all library bytes must be
      // attached/read by Tau first and then inlined through this registry.
      if (/^\s*\.(?:include|inc|lib)\b/i.test(line)) return [];
      if (/^\s*\.model\b/i.test(line)) return stripNoiselessFlag(translateSwitchModelCard(line));
      let out = line;
      if (/^\s*S[\w$]/i.test(out) && out.includes("(")) {
        out = out.replace(/\(([^()]*)\)/, (_full, inner: string) => inner.replace(/,/g, " ").trim());
      }
      out = replaceLtspiceConstants(ltFuncsToNgspice(ifToTernary(stripNoiselessFlag(out))));
      out = translateDiodeArea(out);
      out = translateDirectedG(out, subcktName);
      out = translateDissipativeCurrentLoad(out);
      return translateLtspiceOta(out, subcktName)
        .flatMap((translated) => translatePassiveParasitics(translated, subcktName));
    });
  return translateIdealDiodes(normalized)
    .join("\n");
}

/**
 * Parse one or more raw vendor library file texts into a combined registry.
 * When the same model/subckt name appears more than once (within one file or
 * across several), the FIRST definition wins and later duplicates are
 * ignored - consistent with how the deck builder's own dedup sets treat a
 * name as claimed once it is known (spiceNetlist.ts's `knownModels`/
 * `emittedSubckts`). A `.model` line is stored with its LTspice string-valued
 * annotation parameters removed (see {@link stripAnnotationParams}) and its
 * bare `noiseless` flag stripped (see {@link stripNoiselessFlag}) so the inlined
 * card actually loads in ngspice; `.subckt` blocks are captured as the vendor
 * wrote them except for the LTspice-only constructs ngspice rejects, which are
 * normalized in place (see {@link normalizeSubcktInterior}).
 *
 * This "first wins" rule is deterministic across two attached libraries that
 * both define the same name: `texts` is walked in array order, and the caller
 * always builds that array from the schematic's `userModelLibraries` in
 * attachment order (each `attachModelLibrary` call appends - see
 * store/useSchematic.ts) - so "first in `texts`" always means "first
 * attached", never an arbitrary iteration order.
 */
export function parseUserModelLibraries(texts: readonly string[]): UserModelLibraryRegistry {
  const models = new Map<string, string>();
  const subckts = new Map<string, string>();

  for (const text of texts) {
    const rawLines = text.replace(/\r\n/g, "\n").split("\n");
    let i = 0;
    while (i < rawLines.length) {
      const trimmed = rawLines[i].trim();

      // Blank lines and full-line `*` comments carry no definition.
      if (trimmed === "" || trimmed.startsWith("*")) {
        i += 1;
        continue;
      }

      // `.subckt … .ends`: captured verbatim, nesting-aware. A block may
      // legitimately contain its own nested `.subckt`/`.model`/comments;
      // touching the interior risks corrupting text ngspice already accepts
      // as-is, so only the outer span is sliced out and stored untouched.
      if (/^\.subckt\b/i.test(trimmed)) {
        const start = i;
        let depth = 1;
        i += 1;
        while (i < rawLines.length && depth > 0) {
          const inner = rawLines[i].trim();
          if (/^\.subckt\b/i.test(inner)) depth += 1;
          else if (/^\.ends\b/i.test(inner)) depth -= 1;
          i += 1;
        }
        const block = normalizeSubcktInterior(rawLines.slice(start, i).join("\n").trimEnd());
        const name = /^\.subckt\s+([^\s(]+)/i.exec(trimmed)?.[1];
        if (name) {
          const key = sanitizeSubcktName(name).toLowerCase();
          if (!subckts.has(key)) subckts.set(key, block);
        }
        continue;
      }

      // `.include`/`.lib`: a further file this unit does not recurse into -
      // skip so it never leaks into deck output as a bare directive the
      // native sanitizer would reject.
      if (/^\.(?:include|lib)\b/i.test(trimmed)) {
        i += 1;
        continue;
      }

      // `.model`, with any `+`-continuation lines folded into one logical
      // line - the same fold paramScope.ts's `expandDirectiveLines` applies
      // to single-line directives, so the stored text is always one
      // ngspice-ready line regardless of how the vendor file wrapped it.
      if (/^\.model\b/i.test(trimmed)) {
        const parts = [stripTrailingComment(trimmed)];
        i += 1;
        while (i < rawLines.length) {
          const cont = rawLines[i].trim();
          if (!cont.startsWith("+")) break;
          parts.push(stripTrailingComment(cont.slice(1).trim()));
          i += 1;
        }
        const line = stripNoiselessFlag(translateSwitchModelCard(
          stripAnnotationParams(parts.filter((part) => part !== "").join(" ")),
        ));
        const name = /^\.model\s+([^\s(]+)/i.exec(line)?.[1];
        if (name) {
          const key = name.toLowerCase();
          if (!models.has(key)) models.set(key, line);
        }
        continue;
      }

      // Anything else (.param, .options, other directives, …) carries no
      // model/subckt definition for this registry - skip.
      i += 1;
    }
  }

  return { models, subckts };
}

/**
 * Look up a `.model` line by name (case-insensitive), tolerating a value that
 * carries trailing tokens after the name - the same calling convention as
 * standardModels.ts's `standardModelLine`. Returns `null` when the registry
 * has no such model.
 */
export function resolveUserModel(registry: UserModelLibraryRegistry, name: string): string | null {
  const key = name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return key ? registry.models.get(key) ?? null : null;
}

/**
 * Look up a `.subckt … .ends` block by name (case-insensitive, sanitized like
 * {@link sanitizeSubcktName}), tolerating a value that carries trailing
 * instance params - the same calling convention as bundledSubcircuits.ts's
 * `bundledSubcircuitBlock`. Returns `null` when the registry has no such
 * subckt.
 */
export function resolveUserSubckt(registry: UserModelLibraryRegistry, name: string): string | null {
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  const block = registry.subckts.get(sanitizeSubcktName(first).toLowerCase()) ?? null;
  if (!block) return null;
  const refusal = block.split("\n").find((line) => line.startsWith(TAU_MODEL_REFUSAL_MARKER));
  if (refusal) {
    throw new Error(`Simulation refused: ${refusal.slice(TAU_MODEL_REFUSAL_MARKER.length)} No approximate or partial circuit was run.`);
  }
  return block;
}
