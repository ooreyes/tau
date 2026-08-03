#!/usr/bin/env python3
"""Exercise the exact Tau executable and ngspice library shipped in a bundle."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys


RESPONSE_MARKER = b"TAU_SPICE_RESPONSE_V1:"
SMOKE_DECK = """Tau packaged XSPICE smoke
VDRIVE drive 0 PULSE(0 1 1u 1n 1n 1u 2u)
.model tau_smoke_adc adc_bridge(in_low=0.4 in_high=0.6)
AADC [drive] [din] tau_smoke_adc
.model tau_smoke_buffer d_buffer(rise_delay=10n fall_delay=10n inertial_delay=true)
ABUF din dout tau_smoke_buffer
.model tau_smoke_dac dac_bridge(out_low=0 out_high=5 t_rise=1n t_fall=1n)
ADAC [dout] [out] tau_smoke_dac
RLOAD out 0 1k
.tran 10n 3u
.end
"""


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"packaged engine smoke: {message}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("executable", type=Path)
    parser.add_argument("library", type=Path)
    args = parser.parse_args()

    executable = args.executable.resolve()
    library = args.library.resolve()
    if not executable.is_file():
        fail(f"Tau executable is missing: {executable}")
    if not library.is_file():
        fail(f"ngspice library is missing: {library}")

    request = {
        "request": {"netlist": SMOKE_DECK},
        "libraryCandidates": [str(library)],
    }
    try:
        completed = subprocess.run(
            [str(executable), "--tau-spice-worker"],
            input=json.dumps(request).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
    except subprocess.TimeoutExpired:
        fail("Tau's packaged worker exceeded 30 seconds")
    if completed.returncode != 0:
        diagnostic = completed.stderr.decode("utf-8", errors="replace").strip()
        fail(f"Tau's packaged worker exited {completed.returncode}: {diagnostic}")

    marker = completed.stdout.rfind(RESPONSE_MARKER)
    if marker < 0:
        fail("Tau's packaged worker returned no structured response marker")
    try:
        response = json.loads(completed.stdout[marker + len(RESPONSE_MARKER) :])
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"Tau's packaged worker returned invalid JSON: {error}")
    if response.get("error"):
        fail(f"Tau's packaged worker rejected the XSPICE deck: {response['error']}")
    result = response.get("result")
    if not isinstance(result, dict):
        fail("Tau's packaged worker returned no simulation result")

    loaded = Path(result.get("libraryPath", "")).resolve()
    if loaded != library:
        fail(f"worker loaded {loaded}, expected the bundled {library}")
    vectors = {
        str(vector.get("name", "")).lower(): vector.get("real")
        for vector in result.get("vectors", [])
        if isinstance(vector, dict)
    }
    times = vectors.get("time")
    output = vectors.get("out") or vectors.get("v(out)")
    if not isinstance(times, list) or not isinstance(output, list) or len(times) != len(output):
        fail("transient result did not contain aligned time and out vectors")
    if len(times) < 10 or times[-1] < 2.9e-6:
        fail("transient result did not cover the requested three microseconds")
    if min(output) > 0.5 or max(output) < 4.5:
        fail(f"XSPICE output did not switch rail-to-rail (min={min(output)}, max={max(output)})")

    print(
        "packaged engine smoke: passed "
        f"({len(times)} samples, out={min(output):.3g}..{max(output):.3g} V, {library})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
