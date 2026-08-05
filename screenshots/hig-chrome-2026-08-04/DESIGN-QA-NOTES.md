# Design QA — HIG chrome screenshots (2026-08-04)

**Reviewed:** `screenshots/hig-chrome-2026-08-04/` · Cupertino `6aa5f98`  
**Verdict:** **Apple / Anduril / Palantir-adjacent — not shippable; not childish.**  
**§10 DoD:** remains unchecked (palette pop still owned by Anduril Light).

## Scorecard

| Shot | Mode | Read |
|------|------|------|
| `empty-light` | Light | Strong HIG empty state; Lucide rail; blue primary CTA. Closest to product-ready first paint. |
| `empty-dark` | Dark | Pro industrial chrome; cream/parchment primary CTA pops. Good Anduril-dark energy. |
| `dialog-light` | Light | Settings + empty; functional but **neutral-gray dominant** — needs Anduril Light token pop. |
| `dialog-dark` | Dark | Same structure; coral “New blank” + green Ready are the only accents. |
| `schematic-dark*` | Light* | RC editor + library; Lucide tool strip clean. Filename says dark; frame reads light product. |
| `inspector-dark*` | Light* | Properties inspector dense-but-calm; muted blue selection. |
| `model-dark*` | Light* | Buck converter + model field; engineering-grade, still gray-first. |

\*Several `*-dark-*` filenames render as the light product surface — naming/theme capture drift for Anduril to note, not an icon issue.

## What Cupertino fixed

- Smiley / playful chrome → thin Lucide strokes
- Light product default visible on empty + dialog light
- Segmented Schematic/Simulator, status-bar kbd legend: pro, not toy

## Anduril Light handoff (palette only — no icon rewrite)

1. **Light surfaces read “boring gray / SaaS neutral.”** Backgrounds, panels, and hairlines need a warmer or cooler engineered tint + clearer elevation steps (not more icons).
2. **Accent budget is thin.** Primary blue on CTAs/selection works; secondary accents (status, destructive, focus rings) feel bolted-on rather than tokenized.
3. **Dark vs light CTA language diverges** (blue light CTA vs cream dark CTA) — unify into one Anduril Light token set that maps both themes.
4. **Empty-state card** is correct structure; card fill / border / shadow should use the same elevation tokens as Settings/inspector, not a one-off white slab.
5. **Do not** reopen Lucide/Sparkles/mascot icon passes — chrome iconography is closed for this cycle.

## Typecheck unblock (this QA pass)

- `AssistantPanel`: reject reintroduced `Sparkles`; use `MessageSquarePlus` already in-file for local-AI setup head.
- `TelemetryDock.test`: already imports `TelemetryDock` (no `MeasurementsDock` leak on tree).
