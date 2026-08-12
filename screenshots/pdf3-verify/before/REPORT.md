# PDF-3 verification — before

4/12 check runs passed (4/12 items green in every theme and viewport).

| Item | Theme/viewport | Verdict | Measured |
| --- | --- | --- | --- |
| P3-01 | dark 1280x800 | **FAIL** | could not reach the waveform control: no waveform select in the inspector |
| P3-02 | dark 1280x800 | **FAIL** | file row draggable=false (attr null); after dragTo, "p3-02-dark-1280x800.asc" parent is "workspace://Schematics/Project Storage"; landed in Project Storage: true |
| P3-03 | dark 1280x800 | **FAIL** | palette LED stroke chroma 148.0 vs neighbours 5.0 (LED strokes: rgb(209, 209, 214) \| rgb(255, 107, 107)) |
| P3-04A | dark 1280x800 | PASS | overflow trigger 22px wide, inside header: true, gap to root name: 8px (need >= 8), header overflowing: false |
| P3-04B | dark 1280x800 | **FAIL** | heading "Create or open a schematic"; still the stale copy: true; names placing a component: false; keeps an Ask Bode action: true; buttons [Try RC Charging, New schematic, Ask Bode] |
| P3-06 | dark 1280x800 | PASS | root row content at 62px; 0 child row(s) flush with or left of it (none); nested.asc at 76px vs its folder at 64px -> deeper: true |
| P3-07 | dark 1280x800 | PASS | 24 label boxes measured on a 12-part sheet at 64-unit pitch; 0 overlapping pair(s) |
| P3-08 | dark 1280x800 | PASS | 1 ground(s) placed after two tool rotations; orientations [{"rot":0,"mir":false}]; 0 not pin-up |
| P3-10 | dark 1280x800 | **FAIL** | after a hard pan then fit: artwork centre is off by dx=155px dy=0px (tolerance 2px) in a 738x619 visible box; artwork 571x412 fully inside: false; rail open: true |
| P3-11 | dark 1280x800 | **FAIL** | created 1; click selected 1 label id(s); after Backspace 1; after undo 1; after Delete 1 |
| P3-12/13 | dark 1280x800 | **FAIL** | 9 tool buttons (8 enabled); 0 carry a chromatic accent (chroma > 12); 0 distinct accents; probe button reads red: false (rgba(235, 235, 245, 0.6)) |
| P3-14 | dark 1280x800 | **FAIL** | schematic-mode dock tabs [p3-14-dark-1280x800.asc, Errors]; Measurements tab present: false; pre-run diagnostics surfaced for a lone ungrounded resistor: false (0 row(s), badge "null") |

