#!/usr/bin/env bash
set -euo pipefail

# The completion notification is intentionally a two-commit protocol:
#
#   1. Run this script with --record from a clean, fully implemented tree.
#      It executes every machine-verifiable release gate and writes a marker
#      naming the exact commit that passed.
#   2. Commit ONLY .autobuilder-complete. The launchd runner calls
#      --verify-marker and accepts the signal only when the marker commit's
#      parent is the exact commit that passed and the marker is its only diff.
#
# This prevents a prose claim or a stale marker from stopping the builder.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKER="$ROOT/.autobuilder-complete"
MARKER_VERSION=2
MIN_FREE_KIB=$((15 * 1024 * 1024))

die() {
  echo "completion gate: $*" >&2
  exit 1
}

free_kib() {
  df -Pk "$ROOT" | awk 'NR == 2 { print $4 }'
}

verify_marker() {
  [[ -f "$MARKER" ]] || die "missing .autobuilder-complete"
  git -C "$ROOT" diff --quiet || die "working tree has unstaged changes"
  git -C "$ROOT" diff --cached --quiet || die "working tree has staged changes"
  [[ -z "$(git -C "$ROOT" status --porcelain)" ]] || die "working tree is not clean"

  local version verified_commit verified_epoch head parent changed now age
  version="$(sed -n 's/^gate_version=//p' "$MARKER")"
  verified_commit="$(sed -n 's/^verified_commit=//p' "$MARKER")"
  verified_epoch="$(sed -n 's/^verified_epoch=//p' "$MARKER")"
  [[ "$version" = "$MARKER_VERSION" ]] || die "unsupported marker version '$version'"
  [[ "$verified_commit" =~ ^[0-9a-f]{40}$ ]] || die "marker has no valid verified commit"
  [[ "$verified_epoch" =~ ^[0-9]+$ ]] || die "marker has no valid verification time"

  head="$(git -C "$ROOT" rev-parse HEAD)"
  parent="$(git -C "$ROOT" rev-parse HEAD^ 2>/dev/null || true)"
  [[ "$parent" = "$verified_commit" ]] || die "marker is stale: HEAD^ is $parent, expected $verified_commit"
  changed="$(git -C "$ROOT" diff-tree --no-commit-id --name-only -r "$head")"
  [[ "$changed" = ".autobuilder-complete" ]] || die "completion commit changed files other than .autobuilder-complete"

  now="$(date +%s)"
  age=$((now - verified_epoch))
  (( age >= 0 && age <= 86400 )) || die "completion proof is older than 24 hours"
  echo "completion gate: verified marker for $verified_commit"
}

record_completion() {
  cd "$ROOT"
  [[ ! -e "$MARKER" ]] || die "remove the existing marker before recording a new proof"
  [[ -z "$(git status --porcelain)" ]] || die "recording requires a clean working tree"
  local available
  available="$(free_kib)"
  [[ "$available" =~ ^[0-9]+$ ]] || die "could not determine free disk space"
  (( available >= MIN_FREE_KIB )) || die "at least 15 GiB free is required; only $((available / 1024 / 1024)) GiB is available"

  local proof_root proof_dir mount_dir app_log app_pid
  proof_root="${TMPDIR:-/tmp}"
  proof_root="${proof_root%/}"
  proof_dir="$(mktemp -d "$proof_root/tau-completion-proof.XXXXXX")"
  mount_dir=""
  app_log=""
  app_pid=""
  cleanup_record() {
    if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
      kill "$app_pid" >/dev/null 2>&1 || true
      wait "$app_pid" 2>/dev/null || true
    fi
    [[ -z "$mount_dir" ]] || hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 || true
    [[ -z "$app_log" ]] || rm -f -- "$app_log"
    case "$proof_dir" in
      "$proof_root"/tau-completion-proof.*) rm -rf -- "$proof_dir" ;;
      *) die "refusing to remove unexpected proof directory $proof_dir" ;;
    esac
  }
  trap cleanup_record EXIT

  pnpm -C apps/desktop typecheck
  pnpm -C apps/desktop test
  # Pin each UI capability named by the Definition of Done. The full suite
  # above remains the regression authority; this explicit list prevents a
  # future test-config edit from silently excluding the release-critical files.
  pnpm -C apps/desktop exec vitest run \
    src/store/useSchematic.test.ts \
    src/simulation/plotExpression.test.ts \
    src/simulation/cursors.test.ts \
    src/simulation/fft.test.ts \
    src/simulation/stepFamily.test.ts \
    src/simulation/stepAnalysisFamily.test.ts \
    src/simulation/waveformCsv.test.ts \
    src/components/SimulationPanel.test.tsx
  scripts/acceptance-corpus.sh
  scripts/dod-parity.sh
  pnpm -C apps/desktop exec vitest run --config vitest.corpus.config.ts \
    scripts/acNative.corpus.ts scripts/opNative.corpus.ts scripts/currentSwitchNative.corpus.ts \
    scripts/behavioralCapacitorNative.corpus.ts scripts/userSubcktImport.corpus.ts
  pnpm --filter @tau/desktop build
  TAU_SCREENSHOT_ROOT="$proof_dir/screenshots" \
    TAU_DESIGN_PORT=41730 \
    TAU_DESIGN_FORCE_SERVER=1 \
    node scripts/design-shot.mjs completion
  local screenshot_count
  screenshot_count="$(find "$proof_dir/screenshots/completion" -type f -name '*.png' | wc -l | tr -d '[:space:]')"
  [[ "$screenshot_count" = "48" ]] || die "visual matrix produced $screenshot_count screenshots, expected 48"

  cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
  cargo clippy --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
  cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

  local resource_dir library
  resource_dir="$ROOT/apps/desktop/src-tauri/resources/ngspice"
  library="$resource_dir/lib/libngspice.dylib"
  [[ -f "$library" ]] || die "staged ngspice is missing; run scripts/build-ngspice.sh"
  TAU_NGSPICE_LIB="$library" cargo test \
    --manifest-path apps/desktop/src-tauri/Cargo.toml \
    -- --ignored --test-threads=1

  pnpm --filter @tau/desktop tauri build

  local app dmg mounted_app mounted_library mounted_resource
  app="$ROOT/apps/desktop/src-tauri/target/release/bundle/macos/Tau.app"
  dmg="$(find "$ROOT/apps/desktop/src-tauri/target/release/bundle/dmg" -maxdepth 1 -type f -name '*.dmg' -print -quit)"
  [[ -d "$app" ]] || die "tauri build produced no Tau.app"
  [[ -n "$dmg" && -f "$dmg" ]] || die "tauri build produced no DMG"
  codesign --verify --deep --strict "$app"
  scripts/verify-macos-deployment-target.sh "$app" --require-macos
  hdiutil verify "$dmg"

  mount_dir="$proof_dir/mount"
  mkdir "$mount_dir"
  app_log="$proof_dir/app.log"
  hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount_dir" -quiet
  mounted_app="$mount_dir/Tau.app"
  [[ -x "$mounted_app/Contents/MacOS/tau" ]] || die "mounted DMG has no runnable Tau executable"
  mounted_resource="$mounted_app/Contents/Resources/ngspice"
  mounted_library="$mounted_resource/lib/libngspice.dylib"
  [[ -f "$mounted_library" ]] || die "mounted Tau.app has no bundled ngspice library"
  scripts/verify-macos-deployment-target.sh "$mounted_app" --require-macos
  # build.rs verified every source-resource digest before packaging. Require
  # the DMG to contain that exact tree so a copy/sign/bundle defect cannot
  # mutate an unexercised support file and still produce a completion signal.
  diff -rq "$resource_dir" "$mounted_resource" ||
    die "mounted Tau.app's ngspice resource differs from the verified staged tree"
  # The source resource passed above does not prove the DMG contains the same
  # runnable engine or its adjacent XSPICE modules. Exercise the library from
  # the mounted app bundle before this proof is allowed to notify completion.
  TAU_NGSPICE_LIB="$mounted_library" cargo test \
    --manifest-path apps/desktop/src-tauri/Cargo.toml \
    -- --ignored --test-threads=1
  # Cargo tests use Tau's Rust engine against the mounted resource. This final
  # smoke uses the mounted Tau executable itself and its private worker protocol,
  # proving that the packaged binary can load its bundled XSPICE modules and
  # return a structured transient result before any notification is possible.
  python3 scripts/packaged-engine-smoke.py \
    "$mounted_app/Contents/MacOS/tau" "$mounted_library"
  # The DMG is deliberately mounted read-only; logging under `mount_dir`
  # makes a healthy app fail before it can launch. Keep runtime output in a
  # separate temporary file outside the mounted filesystem.
  "$mounted_app/Contents/MacOS/tau" >"$app_log" 2>&1 &
  app_pid=$!
  sleep 5
  kill -0 "$app_pid" 2>/dev/null || die "Tau.app did not stay alive for five seconds"
  kill "$app_pid" >/dev/null 2>&1 || true
  wait "$app_pid" 2>/dev/null || true
  app_pid=""
  hdiutil detach "$mount_dir" -quiet
  mount_dir=""
  rm -f -- "$app_log"
  app_log=""
  case "$proof_dir" in
    "$proof_root"/tau-completion-proof.*) rm -rf -- "$proof_dir" ;;
    *) die "refusing to remove unexpected proof directory $proof_dir" ;;
  esac
  proof_dir=""
  trap - EXIT

  local verified_commit verified_epoch
  verified_commit="$(git rev-parse HEAD)"
  verified_epoch="$(date +%s)"
  printf 'gate_version=%s\nverified_commit=%s\nverified_epoch=%s\n' \
    "$MARKER_VERSION" "$verified_commit" "$verified_epoch" > "$MARKER"
  echo "completion gate: all gates passed for $verified_commit"
  echo "Commit ONLY .autobuilder-complete, push it, then print AUTOBUILDER_PROJECT_COMPLETE."
}

case "${1:-}" in
  --record) record_completion ;;
  --verify-marker) verify_marker ;;
  *) die "usage: $0 --record | --verify-marker" ;;
esac
