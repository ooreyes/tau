# Overnight Tau builder (Cursor Python SDK)

Unattended local agents against this repo via [`cursor-sdk`](https://cursor.com/docs/sdk/python).

## Setup

```bash
pip install cursor-sdk
export CURSOR_API_KEY="cursor_..."   # https://cursor.com/dashboard/api
python scripts/tau_overnight_sdk.py
```

## Common flags

```bash
# 8 hours (default) or stop after 12 units
python scripts/tau_overnight_sdk.py --hours 8 --units 12

# Resume the last agent_id from ~/.tau-overnight-sdk-state.json between units
python scripts/tau_overnight_sdk.py --resume

# Inspect models available to this API key
python scripts/tau_overnight_sdk.py --list-models

# Print config + unit prompt without calling the API
python scripts/tau_overnight_sdk.py --dry-run
```

Each unit logs `agent_id` and `run.id`, distinguishes `CursorAgentError` (startup)
from `result.status == "error"` (run failed), and appends a summary to
`~/Desktop/TAU-MORNING-STATUS.md`.

Default model is `composer-2.5` (required for local). Override with `--model` or
`TAU_OVERNIGHT_MODEL`.
