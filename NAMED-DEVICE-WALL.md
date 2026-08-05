# Tau named-device wall — exact-rate stuck at 48.1% (need ≥95%)

**Date:** 2026-08-05  
**Tip measured:** `9d29932` (+ this wall-doc commit)  
**SHIPPABLE?** **NO** — DoD named-device box stays unchecked.

This is the Omar-visible wall for the AGENTS.md named-device fidelity floor.
Tau will **not** silently substitute generics, decrypt LTspice models, or
weaken Chan / NIGBT / FRA refusals to inflate the rate.

---

## Measured stdout (source of truth)

```
NAMED-DEVICE: exact=2 refuse=4 silent=0
NAMED-DEVICE-RECURSIVE: unencrypted=2541 exact=1222 refuse=1319 silent=0
  hard-failure=0 encrypted-excluded=1471 exact-rate=48.1%
(DoD ≥95% floor NOT met or not claimable: exact-rate=48.1% silent=0 hard-failure=0)
```

Re-run anytime:

```bash
bash scripts/named-device-fidelity.sh
# optional refuse breakdown:
NAMED_DEVICE_REFUSE_TRIAGE=1 bash scripts/named-device-fidelity.sh
```

**Math:** ≥95% of 2541 unencrypted needs **≥2414 exact**. We have **1222**.
Gap ≈ **1192**. Almost the entire `refuse=1319` bucket must become exact —
and that bucket is dominated by **encrypted Analog Devices / LTC vendor
`.sub` bodies** already installed under LTspice, not by missing Tau maps.

---

## Verdict

**≥95% is impossible from Tau code alone** on this corpus.

- Honest plaintext climbs already landed (standard libs, `ADI.lib` /
  `ADI1.lib` / `LTC.lib` twins, Educational PAsystem discrete aliases,
  TIP121/TIP127 Prefix-X + sibling `.lib`).
- Downloads + Documents sibling-`.lib` leftovers: **0** remaining climb
  candidates beyond what is already exact.
- Remaining refuse mass is **encrypted bare SYMBOL** Applications examples
  (`AD4000.sub`, `ADA4523-1.sub`, `ADM7150_*.sub`, `ADP*`, `LTC*`, …).
  Bytes start with `<Binary File>`; Tau correctly skips them and refuses
  instead of inventing a model.
- Moving those rows into `encrypted-excluded` would shrink the denominator
  and fake a higher exact-rate — **rejected** (CEO: no denominator games).
  Encrypted bare SYMBOL stays honest **refuse**.

---

## Refuse classes (do not weaken)

| Class | What it is | Path to exact |
| --- | --- | --- |
| **Encrypted ADI/LTC Applications** (bulk of 1319) | Installed `lib/sub/*.sub` is LTspice-encrypted; Prefix-X symbol has no electrically equivalent Tau model | Omar installs **plaintext** vendor `.lib`/`.sub` (same stem) into Tau Model libraries / LTspice `lib/sub` |
| **NIGBT** | `Educational/IGBT.asc` — LTspice-only intrinsic | Permanent refuse (keep). Use `IGBTeq.asc` for parity work |
| **Chan-core inductor** | NonLinearTransformer Chan core | Permanent refuse (keep) |
| **FRA / PowerProducts encrypted** | `FRA/fra_eg2…9` etc. encrypted `LT8609.sub`, `LTC3869.sub`, … | Same as encrypted Applications: need plaintext twins |
| **Royer `LT1184F`** | Unresolved encrypted subckt | Already `encrypted-excluded`; keep fail-closed |

`silent=0` and `hard-failure=0` **held** — do not trade those for rate.

---

## Exact install instructions (Omar)

Tau only accepts **plaintext** SPICE text (`.lib` / `.sub` / `.mod` with
`.subckt` / `.model`). Encrypted LTspice `<Binary File>` blobs never count.

### 1. Confirm what you already have

```bash
# LTspice Application Support library (already present on this Mac):
ls "$HOME/Library/Application Support/LTspice/lib/sub" | head
# Encrypted example (will NOT help Tau):
file "$HOME/Library/Application Support/LTspice/lib/sub/AD4000.sub"
# → data / binary — skipped by Tau
```

### 2. Obtain plaintext models (outside Tau)

For each refused Applications part (examples from refuse triage):

- ADCs: `AD4000`, `AD4001`, `LTC2311-*`, `LTC2323-*`, …
- Op-amps: `ADA4523-1`, …
- Regulators / PMICs: `ADM7150-*`, `ADM7170-*`, `ADP121-*`, `ADP2108-*`, …
- Power / drivers: `LTC4449`, `LT8609`, …

Sources (pick one per part; Tau must not redistribute LTspice assets):

1. **Analog Devices / Analog.com** — download the public SPICE macromodel
   ZIP for that part number (usually a `.cir` / `.lib` text file).
2. **Vendor “LTspice-compatible” plaintext** from the product page — not the
   encrypted body shipped inside LTspice.app / Application Support.
3. Your own authored `.subckt` that matches the symbol pin order
   (`SpiceOrder` on the `.asy`).

### 3. Install where Tau can see them

**Preferred (product path):** Tau → Model libraries → attach the plaintext
file to the schematic (or put it in the project folder and `.lib` /
`.include` it).

**Corpus / installed-library path:** copy the plaintext file next to the
encrypted twin so the same stem resolves:

```bash
SUB="$HOME/Library/Application Support/LTspice/lib/sub"
# Example: plaintext AD4000 from ADI site saved as AD4000.lib
cp ~/Downloads/AD4000.lib "$SUB/AD4000.lib"
# Tau tries authored .sub then same-stem .lib/.mod and skips encrypted bytes.
```

Pin/subckt name must match what the `.asy` / schematic requests (often the
part leaf, e.g. `.subckt AD4000 …`).

### 4. Re-measure

```bash
cd /path/to/Tau
bash scripts/named-device-fidelity.sh
```

Only a measured `exact-rate≥95%` with `silent=0` and `hard-failure=0` may
claim the DoD box. Do **not** check the box from this wall doc.

### 5. What will not work

- Leaving only LTspice’s encrypted `.sub` in place (current machine state).
- Asking Tau to decrypt, approximate, or map to `TAU_*` generics.
- Reclassifying encrypted bare SYMBOL → `encrypted-excluded` to juice %.
- Weakening NIGBT / Chan / FRA refusals.

---

## Already proven exact (do not re-audit without regression)

- Unit proof: `NAMED-DEVICE: exact=2 refuse=4 silent=0`
- Recursive plaintext climbs: standard.dio/bjt/mos/jft, ADI/LTC plaintext
  twins, Educational PAsystem aliases, TIP121/TIP127 + sibling `.lib`
- Integrity: `silent=0`, `hard-failure=0`

---

## Repo copy

Committed twin: `NAMED-DEVICE-WALL.md` at the Tau repo root (same content).
