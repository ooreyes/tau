# PDF-6 verification — pdf6-full-1

35/40 check runs passed (8/10 items green in every theme and viewport).

| Item | Theme/viewport | Verdict | Measured |
| --- | --- | --- | --- |
| P6-01 | light 900x600 | PASS | "p6-01-light-900x600.asc" parent after a real pointer drag: "workspace://Schematics/Charging Circuit"; landed in folder: true; drop-target highlight seen mid-drag: true (0/0/0/2/2/2); drag ghost seen: false; rows still carrying draggable: 0 (must be 0 - WKWebView hijacks those) |
| P6-02 | light 900x600 | PASS | 5 icons, glyph-edge gaps 8/8/8/8 px (worst 8, budget 8, was 12 before this pass); hit box 24x24 px (floor 24) |
| P6-03 | light 900x600 | PASS | 1 window config(s), dragDropEnabled=[false] (must all be false so WKWebView stops intercepting); code listens for tauri drag-drop events: false |
| P6-04 | light 900x600 | PASS | rail left edge at x=0; 0 descendant(s) paint left of it (was 1: .rail-active at left:-4px, landing on x=0) |
| P6-05 | light 900x600 | PASS | clean: 1 tab(s), 0 colour chip(s), 0 dot(s); after an edit: 0 chip(s), 1 dot(s). Budget: chips 0 always (was 1 per tab), dots 0 clean / 1 unsaved |
| P6-09 | light 900x600 | PASS | first glyph at x=78 (traffic-light inset floor 70), cluster ends x=364; collides with the mode toggle at x=380: false; truncates a long name: true; 0 labelled marker(s); reads "τp6-09-a-buck-converter-25V-to-5V-synchronous-light-900x600." |
| P6-10 | light 900x600 | PASS | 51 hint(s) across 58 palette item(s); 1 distinct left offset(s) (780), spread 0px, budget 1px |
| P6-06 | light 900x600 | PASS | button present: true; the app's own RC example reads health=ok badge="" name="Diagnostics: no problems" with no Run (it was "error / 3 problems" until the inline-source-waveform fix); toggle raises and puts away the window: true ({"before":"peek/0px","opened":"half/28px","closed":"peek/0px","works":true}); no-ground run health=error (must be error - it will not run); policy persists: {"severityPolicy":"errors-only"}. The severity truth table itself is unit-tested in lib/diagnosticsHealth.test.ts; this check proves the wiring, not the table. |
| P6-07 | light 900x600 | PASS | 6 rail buttons [Explorer, Search, Components, Waveforms, Diagnostics: 3 problems, this circuit will not run, Settings]; unnamed 0; undersized 0; buttons sharing a glyph 0 |
| P6-08 | light 900x600 | **FAIL** | 40 moves in 351ms (8.8ms/move, budget 12); 3 distinct live widths (floor 20); settled at 306px vs last live 306px |
| P6-01 | light 1280x800 | PASS | "p6-01-light-1280x800.asc" parent after a real pointer drag: "workspace://Schematics/Charging Circuit"; landed in folder: true; drop-target highlight seen mid-drag: true (0/0/0/2/2/2); drag ghost seen: false; rows still carrying draggable: 0 (must be 0 - WKWebView hijacks those) |
| P6-02 | light 1280x800 | PASS | 5 icons, glyph-edge gaps 8/8/8/8 px (worst 8, budget 8, was 12 before this pass); hit box 24x24 px (floor 24) |
| P6-03 | light 1280x800 | PASS | 1 window config(s), dragDropEnabled=[false] (must all be false so WKWebView stops intercepting); code listens for tauri drag-drop events: false |
| P6-04 | light 1280x800 | PASS | rail left edge at x=0; 0 descendant(s) paint left of it (was 1: .rail-active at left:-4px, landing on x=0) |
| P6-05 | light 1280x800 | PASS | clean: 1 tab(s), 0 colour chip(s), 0 dot(s); after an edit: 0 chip(s), 1 dot(s). Budget: chips 0 always (was 1 per tab), dots 0 clean / 1 unsaved |
| P6-09 | light 1280x800 | PASS | first glyph at x=78 (traffic-light inset floor 70), cluster ends x=554; collides with the mode toggle at x=570: false; truncates a long name: true; 0 labelled marker(s); reads "τp6-09-a-buck-converter-25V-to-5V-synchronous-light-1280x800" |
| P6-10 | light 1280x800 | PASS | 51 hint(s) across 58 palette item(s); 1 distinct left offset(s) (1160), spread 0px, budget 1px |
| P6-06 | light 1280x800 | **FAIL** | THREW: locator.click: Error: strict mode violation: getByRole('button', { name: /Try RC Charging/ }) resolved to 2 elements:
    1) <button type="button" data-slot="button" class="inline-flex shrink-0 cursor-pointer select-none appearance-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-xs font-medium [font-family:inherit] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2.5">…</button> aka getByLabel('Empty schematic').getByRole('button', { name: 'Try RC Charging' })
    2) <button type="button" data-slot="button" class="inline-flex shrink-0 cursor-pointer select-none appearance-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-xs font-medium [font-family:inherit] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2.5">Try RC Charging</button> aka getByLabel('Learning path').getByRole('button', { name: 'Try RC Charging' })

Call log:
  - waiting for getByRole('button', { name: /Try RC Charging/ })
 |
| P6-07 | light 1280x800 | PASS | 6 rail buttons [Explorer, Search, Components, Waveforms, Diagnostics: 3 problems, this circuit will not run, Settings]; unnamed 0; undersized 0; buttons sharing a glyph 0 |
| P6-08 | light 1280x800 | PASS | 40 moves in 459ms (11.5ms/move, budget 12); 40 distinct live widths (floor 20); settled at 380px vs last live 380px |
| P6-01 | dark 900x600 | PASS | "p6-01-dark-900x600.asc" parent after a real pointer drag: "workspace://Schematics/Charging Circuit"; landed in folder: true; drop-target highlight seen mid-drag: true (0/0/0/2/2/2); drag ghost seen: false; rows still carrying draggable: 0 (must be 0 - WKWebView hijacks those) |
| P6-02 | dark 900x600 | PASS | 5 icons, glyph-edge gaps 8/8/8/8 px (worst 8, budget 8, was 12 before this pass); hit box 24x24 px (floor 24) |
| P6-03 | dark 900x600 | PASS | 1 window config(s), dragDropEnabled=[false] (must all be false so WKWebView stops intercepting); code listens for tauri drag-drop events: false |
| P6-04 | dark 900x600 | PASS | rail left edge at x=0; 0 descendant(s) paint left of it (was 1: .rail-active at left:-4px, landing on x=0) |
| P6-05 | dark 900x600 | PASS | clean: 1 tab(s), 0 colour chip(s), 0 dot(s); after an edit: 0 chip(s), 1 dot(s). Budget: chips 0 always (was 1 per tab), dots 0 clean / 1 unsaved |
| P6-09 | dark 900x600 | PASS | first glyph at x=78 (traffic-light inset floor 70), cluster ends x=364; collides with the mode toggle at x=380: false; truncates a long name: true; 0 labelled marker(s); reads "τp6-09-a-buck-converter-25V-to-5V-synchronous-dark-900x600.a" |
| P6-10 | dark 900x600 | PASS | 51 hint(s) across 58 palette item(s); 1 distinct left offset(s) (780), spread 0px, budget 1px |
| P6-06 | dark 900x600 | **FAIL** | THREW: locator.click: Error: strict mode violation: getByRole('button', { name: /Try RC Charging/ }) resolved to 2 elements:
    1) <button type="button" data-slot="button" class="inline-flex shrink-0 cursor-pointer select-none appearance-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-xs font-medium [font-family:inherit] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2.5">…</button> aka getByLabel('Empty schematic').getByRole('button', { name: 'Try RC Charging' })
    2) <button type="button" data-slot="button" class="inline-flex shrink-0 cursor-pointer select-none appearance-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-xs font-medium [font-family:inherit] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2.5">Try RC Charging</button> aka getByLabel('Learning path').getByRole('button', { name: 'Try RC Charging' })

Call log:
  - waiting for getByRole('button', { name: /Try RC Charging/ })
 |
| P6-07 | dark 900x600 | PASS | 6 rail buttons [Explorer, Search, Components, Waveforms, Diagnostics: 3 problems, this circuit will not run, Settings]; unnamed 0; undersized 0; buttons sharing a glyph 0 |
| P6-08 | dark 900x600 | **FAIL** | 40 moves in 352ms (8.8ms/move, budget 12); 3 distinct live widths (floor 20); settled at 306px vs last live 306px |
| P6-01 | dark 1280x800 | PASS | "p6-01-dark-1280x800.asc" parent after a real pointer drag: "workspace://Schematics/Charging Circuit"; landed in folder: true; drop-target highlight seen mid-drag: true (0/0/0/2/2/2); drag ghost seen: false; rows still carrying draggable: 0 (must be 0 - WKWebView hijacks those) |
| P6-02 | dark 1280x800 | PASS | 5 icons, glyph-edge gaps 8/8/8/8 px (worst 8, budget 8, was 12 before this pass); hit box 24x24 px (floor 24) |
| P6-03 | dark 1280x800 | PASS | 1 window config(s), dragDropEnabled=[false] (must all be false so WKWebView stops intercepting); code listens for tauri drag-drop events: false |
| P6-04 | dark 1280x800 | PASS | rail left edge at x=0; 0 descendant(s) paint left of it (was 1: .rail-active at left:-4px, landing on x=0) |
| P6-05 | dark 1280x800 | PASS | clean: 1 tab(s), 0 colour chip(s), 0 dot(s); after an edit: 0 chip(s), 1 dot(s). Budget: chips 0 always (was 1 per tab), dots 0 clean / 1 unsaved |
| P6-09 | dark 1280x800 | PASS | first glyph at x=78 (traffic-light inset floor 70), cluster ends x=554; collides with the mode toggle at x=570: false; truncates a long name: true; 0 labelled marker(s); reads "τp6-09-a-buck-converter-25V-to-5V-synchronous-dark-1280x800." |
| P6-10 | dark 1280x800 | PASS | 51 hint(s) across 58 palette item(s); 1 distinct left offset(s) (1160), spread 0px, budget 1px |
| P6-06 | dark 1280x800 | **FAIL** | THREW: locator.click: Error: strict mode violation: getByRole('button', { name: /Try RC Charging/ }) resolved to 2 elements:
    1) <button type="button" data-slot="button" class="inline-flex shrink-0 cursor-pointer select-none appearance-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-xs font-medium [font-family:inherit] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2.5">…</button> aka getByLabel('Empty schematic').getByRole('button', { name: 'Try RC Charging' })
    2) <button type="button" data-slot="button" class="inline-flex shrink-0 cursor-pointer select-none appearance-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-xs font-medium [font-family:inherit] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2.5">Try RC Charging</button> aka getByLabel('Learning path').getByRole('button', { name: 'Try RC Charging' })

Call log:
  - waiting for getByRole('button', { name: /Try RC Charging/ })
 |
| P6-07 | dark 1280x800 | PASS | 6 rail buttons [Explorer, Search, Components, Waveforms, Diagnostics: 3 problems, this circuit will not run, Settings]; unnamed 0; undersized 0; buttons sharing a glyph 0 |
| P6-08 | dark 1280x800 | PASS | 40 moves in 421ms (10.5ms/move, budget 12); 40 distinct live widths (floor 20); settled at 380px vs last live 380px |

