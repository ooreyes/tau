# PDF-6 verification — pdf6-quick-3

1/1 check runs passed (1/1 items green in every theme and viewport).

| Item | Theme/viewport | Verdict | Measured |
| --- | --- | --- | --- |
| P6-06 | dark 1280x800 | PASS | button present: true; the app's own RC example reads health=ok badge="" name="Diagnostics: no problems" with no Run (it was "error / 3 problems" until the inline-source-waveform fix); toggle raises and puts away the window: true ({"before":"peek/0px","opened":"half/28px","closed":"peek/0px","works":true}); no-ground run health=error (must be error - it will not run); policy persists: {"severityPolicy":"errors-only"}. The severity truth table itself is unit-tested in lib/diagnosticsHealth.test.ts; this check proves the wiring, not the table. |

