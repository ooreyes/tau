# Tau named-device wall — exact-rate stuck at 48.1% (need ≥95%)

**Date:** 2026-08-05  
**Tip measured:** `5129e78` (AD8561 ambiguous-leaf climb)  
**SHIPPABLE?** **NO** — DoD named-device box stays unchecked. Never claim ≥95% from this doc.

This is the Omar-visible wall for the AGENTS.md named-device fidelity floor.
Tau will **not** silently substitute generics, decrypt LTspice models, or
weaken Chan / NIGBT / FRA refusals to inflate the rate.

---

## Measured stdout (source of truth)

```
NAMED-DEVICE: exact=2 refuse=4 silent=0
NAMED-DEVICE-RECURSIVE: unencrypted=2541 exact=1223 refuse=1318 silent=0
  hard-failure=0 encrypted-excluded=1471 exact-rate=48.1%
(DoD ≥95% floor NOT met or not claimable: exact-rate=48.1% silent=0 hard-failure=0)
```

Re-run anytime:

```bash
bash scripts/named-device-fidelity.sh
# enriched refuse breakdown (path family + non-no-equiv dump):
NAMED_DEVICE_REFUSE_TRIAGE=1 bash scripts/named-device-fidelity.sh
```

**Math:** ≥95% of 2541 unencrypted needs **≥2414 exact**. We have **1223**.
Gap ≈ **1191**. Almost the entire `refuse=1318` bucket must become exact —
and that bucket is dominated by **encrypted Analog Devices / LTC vendor
`.sub` bodies** already installed under LTspice, not by missing Tau maps.

---

## Refuse triage (from `NAMED_DEVICE_REFUSE_TRIAGE=1` stdout)

```
REFUSE TRIAGE (1318 files, 325 classes):
  summary: no-electrically-equivalent=1317 other-refuse=1
  by path family:
    1311× Applications
    5× FRA
    2× Educational
```

| Bucket | Count | What it is |
| --- | ---: | --- |
| **no-electrically-equivalent** | **1317** | Bare SYMBOL / Prefix-X whose installed `lib/sub/*.sub` is encrypted (`<Binary File>`) or LTspice-only (NIGBT). Includes Educational `IGBT.asc` (`misc\nigbt`). |
| **other-refuse** | **1** | Chan-core: `Educational/NonLinearTransformer.asc` (dedicated Chan refuse copy — keep). |
| **Applications** | **1311** | Bulk wall: AD4000 / ADA4523-1 / ADM7150-* / ADP* / LTC* / … encrypted Applications examples. |
| **FRA** | **5** | Encrypted FRA examples (`LT8609.sub`, `LTC3869.sub`, …) still counted as refuse (not denominator-excluded). |
| **Educational** | **2** | `IGBT.asc` (NIGBT) + `NonLinearTransformer.asc` (Chan). |

Top collapsed message classes (refdes → `REF`; still 325 raw classes because voltage/bit suffixes stay distinct):

- **558×** `REF (REF)` — e.g. `Applications/AD4000.asc`, `AD4001.asc`
- **85×** `REF (REF-1)` — e.g. `ADA4523-1.asc`, `ADAQ7767-1.asc`
- **49×** `REF (REF-2)` — e.g. `ADP1071-2.asc`, `ADP5138-2.asc`
- then REF-3.3 / 2.5 / 1.8 / … regulator & ADC suffix families

`silent=0` and `hard-failure=0` **held**.

---

## Verdict (re-confirmed this session)

**≥95% is impossible from Tau code alone** on this corpus.

- Honest plaintext climbs already landed (standard libs, `ADI.lib` /
  `ADI1.lib` / `LTC.lib` twins, Educational PAsystem discrete aliases,
  TIP121/TIP127 Prefix-X + sibling `.lib`, AD8561 ambiguous-leaf →
  OpAmps plaintext `.lib` over Comparators encrypted `.sub`).
- Downloads + Documents sibling-`.lib` leftovers: **0** remaining climb
  candidates (only TIP121/TIP127 siblings remain on disk — already exact).
- Spot-check: Applications parts that already have plaintext `lib/sub/*.lib`
  twins (`MAX44245`, `ADA4177`, `AD8237`, `LTC6252`, `LT1521`, `LT6658`, …)
  measure **exact** today — not refuse. No missing Tau map for those.
- Remaining refuse mass is **encrypted bare SYMBOL** (Applications + FRA)
  plus permanent Educational Chan / NIGBT. Ambiguous encrypted-only leaves
  (`AD4858`, `AD8460`) stay honest refuse.
- Moving encrypted bare SYMBOL → `encrypted-excluded` would shrink the
  denominator and fake a higher exact-rate — **rejected** (CEO: no
  denominator games). Encrypted bare SYMBOL stays honest **refuse**.
- **No further honest Tau-owned / sibling exact-map cluster left** without
  silent substitution or weakening Chan / NIGBT / FRA — Omar must install
  plaintext ADI/LTC macromodels.

---

## Refuse classes (do not weaken)

| Class | What it is | Path to exact |
| --- | --- | --- |
| **Encrypted ADI/LTC Applications** (≈1311) | Installed `lib/sub/*.sub` is LTspice-encrypted; Prefix-X symbol has no electrically equivalent Tau model | Omar installs **plaintext** vendor `.lib`/`.sub` (same stem) into Tau Model libraries / LTspice `lib/sub` |
| **NIGBT** | `Educational/IGBT.asc` — LTspice-only intrinsic | Permanent refuse (keep). Use `IGBTeq.asc` for parity work |
| **Chan-core inductor** | `Educational/NonLinearTransformer.asc` | Permanent refuse (keep) |
| **FRA encrypted** (5) | `FRA/fra_eg…` encrypted `LT8609.sub`, `LTC3869.sub`, … | Same as Applications: need plaintext twins |
| **Royer `LT1184F`** | Unresolved encrypted subckt | Already `encrypted-excluded`; keep fail-closed |

---

## Exact install instructions (Omar)

Tau only accepts **plaintext** SPICE text (`.lib` / `.sub` / `.mod` with
`.subckt` / `.model`). Encrypted LTspice `<Binary File>` blobs never count.
**Do not ask Tau to decrypt.**

### 1. Confirm what you already have

```bash
# LTspice Application Support library (already present on this Mac):
ls "$HOME/Library/Application Support/LTspice/lib/sub" | head
# Encrypted example (will NOT help Tau):
file "$HOME/Library/Application Support/LTspice/lib/sub/AD4000.sub"
# → data / binary — skipped by Tau
```

### 2. Obtain plaintext models (outside Tau)

Highest-leverage refuse stems from triage (install plaintext twins for these
families first):

- ADCs: `AD4000`, `AD4001`, `LTC2311-*`, `LTC2323-*`, `AD4630-*`, …
- Op-amps: `ADA4523-1`, …
- Regulators / PMICs: `ADM7150-*`, `ADM7170-*`, `ADP121-*`, `ADP2108-*`, …
- Power / drivers / FRA: `LTC4449`, `LT8609`, `LTC3869`, …

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
- Hunting another Tau-owned exact-map cluster — Downloads/Docs sibling
  climbs, plaintext Application twins, and the AD8561 ambiguous-leaf climb
  are exhausted / exact.

---

## Already proven exact (do not re-audit without regression)

- Unit proof: `NAMED-DEVICE: exact=2 refuse=4 silent=0`
- Recursive plaintext climbs: standard.dio/bjt/mos/jft, ADI/LTC plaintext
  twins, Educational PAsystem aliases, TIP121/TIP127 + sibling `.lib`,
  AD8561 OpAmps plaintext `.lib` (ambiguous Comparators/OpAmps leaf)
- Integrity: `silent=0`, `hard-failure=0`

---

## Repo copy

Committed twin: `NAMED-DEVICE-WALL.md` at the Tau repo root (same content).
Desktop mirror: `~/Desktop/TAU-NAMED-DEVICE-WALL.md`.
