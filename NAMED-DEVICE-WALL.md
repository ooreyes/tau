# Tau named-device wall — exact-rate stuck at 48.1% (need ≥95%)

**Date:** 2026-08-05  
**Tip measured:** `26c97d1` + plaintext-refuse probe (this session)  
**SHIPPABLE?** **NO** — DoD named-device box stays unchecked. Never claim ≥95% from this doc.

This is the Omar-visible wall for the AGENTS.md named-device fidelity floor.
Tau will **not** silently substitute generics, decrypt LTspice models, or
weaken Chan / NIGBT refusals to inflate the rate.

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
# refuse path-family + plaintext-refuse probe + Omar install projection:
NAMED_DEVICE_REFUSE_TRIAGE=1 bash scripts/named-device-fidelity.sh
```

**Math:** ≥95% of 2541 unencrypted needs **≥2414 exact**. We have **1223**.
Gap = **1191**. The refuse bucket is **not** missing Tau maps — see probe below.

---

## Plaintext-refuse probe (option 1 — exhausted)

`NAMED_DEVICE_REFUSE_TRIAGE=1` now prints a **PLAINTEXT-REFUSE PROBE** that, for
every refuse row, resolves Value leaves through installed `.asy`
ModelFile/SpiceModel and checks for an on-disk plaintext twin:

```
PLAINTEXT-REFUSE PROBE (among 1318 refuse):
  plaintext-twin-on-disk=0 encrypted-only=1315 missing-model=2 other=1
  plaintext-twin climb samples: (none — no Tau map debt in refuse set)
  top encrypted-only refuse stems (1142 unique; Omar plaintext install targets):
    …
OMAR INSTALL PROJECTION (…):
  unique stems to install: 1142
  exact 1223→2538 / unencrypted 2541 → 99.9%
  ≥95% needs ≥2414 exact (gap 1191); install covers 1315
```

| Probe bucket | Count | Meaning |
| --- | ---: | --- |
| **plaintext-twin-on-disk** | **0** | No remaining honest Tau exact-map. Every refuse part that already has a plaintext `.lib`/`.sub` twin is already **exact**. |
| **encrypted-only** | **1315** | Installed `lib/sub/<stem>.sub` is LTspice `<Binary File>` with no plaintext twin. |
| **missing-model** | **2** | `nigbt` (permanent Educational IGBT) + one FRA token artifact (`fra`). |
| **other** | **1** | Chan-core: `Educational/NonLinearTransformer.asc` (keep). |

**Verdict:** there is **no further plaintext refuse for Tau to map**. Option 1 is
closed. ≥95% requires Omar plaintext installs (option 2).

---

## Refuse triage (path family)

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
| **Applications** | **1311** | Encrypted bare SYMBOL / Prefix-X examples under `Documents/LTspice/examples/Applications`. |
| **FRA** | **5** | Encrypted FRA examples (`LT8609.sub`, `LTC3869.sub`, …). |
| **Educational** | **2** | `IGBT.asc` (NIGBT) + `NonLinearTransformer.asc` (Chan) — permanent. |

`silent=0` and `hard-failure=0` **held**.

---

## Exact Omar install path (option 2 — moves the rate)

### What to install

**1142 unique plaintext macromodel stems** covering **1315** encrypted-only
refuse circuits. Same stem as the encrypted LTspice body (from `.asy`
`ModelFile` / `SpiceModel`), e.g.:

| Circuits | Stem to install as plaintext |
| ---: | --- |
| 14 | `ADP2503_4` |
| 12 | `ADP2370` |
| 11 each | `ADP2108-x.x`, `ADP2109-x.x`, `ADP7158_9` |
| 10 each | `ADP121`, `ADP122` |
| 9 each | `ADM7150_1`, `ADM7154_5`, `ADP2138-x.x`, `ADP2139-x.x` |
| 8 each | `ADP124`, `ADP505x_chan1_2` |
| … | … (1142 unique — full ranked list in triage stdout) |
| 1 each | `AD4000`, `AD4001`, … (long tail of single-circuit ADCs / parts) |

Voltage-suffixed schematics (e.g. `ADM7150-1.8.asc`) resolve through the `.asy`
to a shared encrypted body (`ADM7150_1.sub`) — install **that** stem, not the
schematic filename.

### Where to put the files

Tau reads LTspice libs from, in order (`ltspiceLibRoot.ts`):

1. `$TAU_LTSPICE_LIB_ROOT` (if set)
2. **`~/.tau-autobuilder/ltspice-models/lib`** (staged autobuilder copy — prefer this for unattended runs / TCC)
3. **`~/Library/Application Support/LTspice/lib`** (interactive LTspice install)

**Corpus path that moves the measured rate** — copy plaintext next to the
encrypted twin so same-stem resolution finds it:

```bash
SUB="$HOME/Library/Application Support/LTspice/lib/sub"
STAGE="$HOME/.tau-autobuilder/ltspice-models/lib/sub"

# Example: ADI plaintext macromodel saved as ADP121.lib
cp ~/Downloads/ADP121.lib "$SUB/ADP121.lib"
mkdir -p "$STAGE" && cp ~/Downloads/ADP121.lib "$STAGE/ADP121.lib"

# Confirm Tau will see plaintext (must NOT be <Binary File>):
file "$SUB/ADP121.lib"
# → ASCII text / Unicode text, NOT "data"
```

**Product path (also works):** Tau → Model libraries → attach the plaintext
`.lib`/`.sub`/`.cir` to the schematic (or project-local `.lib` / `.include`).

Pin / `.subckt` name must match what the `.asy` requests.

### Where **not** to look

| Path | Why it does not help |
| --- | --- |
| LTspice.app / Application Support `lib/sub/*.sub` encrypted bodies | Already present; Tau skips `<Binary File>` |
| Decrypting those blobs | Forbidden — Tau must not decrypt |
| Reclassifying refuse → `encrypted-excluded` | Denominator game — rejected |
| Tau-owned `TAU_*` generics | Silent substitution — rejected |

### Sources (Omar obtains; Tau never redistributes)

1. **Analog.com** product page → SPICE / LTspice-compatible **plaintext** macromodel ZIP (usually `.cir` / `.lib` text).
2. Vendor “unencrypted” / evaluation models — not the encrypted body shipped inside LTspice.
3. Your own `.subckt` matching `.asy` `SpiceOrder`.

### Projected rate after full install (math only — not a claim)

```
exact 1223 → 2538 / unencrypted 2541 → 99.9%
≥95% needs ≥2414 exact (gap 1191); install of 1142 stems covers 1315 refuse
Permanent refuse left: Chan + NIGBT (and any stem still missing plaintext)
```

Only a **re-measured** `exact-rate≥95%` with `silent=0` and `hard-failure=0`
from `scripts/named-device-fidelity.sh` may check the DoD box.

```bash
cd /path/to/Tau
bash scripts/named-device-fidelity.sh
```

---

## Refuse classes (do not weaken)

| Class | Count | Path to exact |
| --- | ---: | --- |
| Encrypted ADI/LTC Applications (+ FRA) | ~1315 | Omar installs plaintext twins for **1142** stems into `lib/sub` (and staged twin) |
| NIGBT | 1 | Permanent refuse — use `IGBTeq.asc` for parity |
| Chan-core inductor | 1 | Permanent refuse |
| Royer `LT1184F` | (encrypted-excluded) | Keep fail-closed |

---

## Already proven exact (do not re-audit without regression)

- Unit proof: `NAMED-DEVICE: exact=2 refuse=4 silent=0`
- Recursive plaintext climbs exhausted: standard.dio/bjt/mos/jft, ADI/LTC
  plaintext twins, Educational PAsystem aliases, TIP121/TIP127 + sibling `.lib`,
  AD8561 OpAmps plaintext `.lib` (ambiguous Comparators/OpAmps leaf)
- **Plaintext-refuse probe = 0** (this session) — no further Tau map cluster
- Integrity: `silent=0`, `hard-failure=0`

---

## Repo copy

Committed twin: `NAMED-DEVICE-WALL.md` at the Tau repo root (same content).
Desktop mirror: `~/Desktop/TAU-NAMED-DEVICE-WALL.md`.
