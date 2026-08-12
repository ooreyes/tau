# Cross-lane handoff requests (PDF-3 remediation)

A lane that needs a change in a file it does not own (see the file-ownership
map in `UI_UX_PDF3.md`) does NOT edit that file. It appends the request here as
`<lane>.md`, in this shape:

    ## <file path>
    Why: <one line>
    Exact change: <the diff, or the precise line to add and where>
    Blocks: <which P3 item cannot be finished without it>

The orchestrator applies these between batches, so two workers can never race
on `App.tsx`, `App.css`, or another shared file.
