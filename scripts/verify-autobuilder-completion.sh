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
MARKER_VERSION=1
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

  pnpm -C apps/desktop typecheck
  pnpm -C apps/desktop test
  scripts/acceptance-corpus.sh
  scripts/dod-parity.sh
  pnpm --filter @tau/desktop build

  cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
  cargo clippy --all-targets --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
  cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml

  local resource_dir library
  resource_dir="$ROOT/apps/desktop/src-tauri/resources/ngspice"
  library="$resource_dir/lib/libngspice.dylib"
  [[ -f "$library" ]] || die "staged ngspice is missing; run scripts/build-ngspice.sh"
  TAU_NGSPICE_LIB="$library" cargo test \
    --manifest-path apps/desktop/src-tauri/Cargo.toml \
    runs_an_operating_point_with_the_real_ngspice_library \
    -- --ignored --test-threads=1
  TAU_NGSPICE_LIB="$library" cargo test \
    --manifest-path apps/desktop/src-tauri/Cargo.toml \
    runs_a_digital_register_with_the_real_ngspice_code_models \
    -- --ignored --test-threads=1

  pnpm --filter @tau/desktop tauri build

  local app dmg mount_dir mounted_app app_pid
  app="$ROOT/apps/desktop/src-tauri/target/release/bundle/macos/Tau.app"
  dmg="$(find "$ROOT/apps/desktop/src-tauri/target/release/bundle/dmg" -maxdepth 1 -type f -name '*.dmg' -print -quit)"
  [[ -d "$app" ]] || die "tauri build produced no Tau.app"
  [[ -n "$dmg" && -f "$dmg" ]] || die "tauri build produced no DMG"
  codesign --verify --deep --strict "$app"
  hdiutil verify "$dmg"

  mount_dir="$(mktemp -d "${TMPDIR:-/tmp}/tau-completion-mount.XXXXXX")"
  cleanup_mount() {
    hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 || true
    rmdir "$mount_dir" >/dev/null 2>&1 || true
  }
  trap cleanup_mount EXIT
  hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount_dir" -quiet
  mounted_app="$mount_dir/Tau.app"
  [[ -x "$mounted_app/Contents/MacOS/tau" ]] || die "mounted DMG has no runnable Tau executable"
  "$mounted_app/Contents/MacOS/tau" >"$mount_dir/tau-app.log" 2>&1 &
  app_pid=$!
  sleep 5
  kill -0 "$app_pid" 2>/dev/null || die "Tau.app did not stay alive for five seconds"
  kill "$app_pid" >/dev/null 2>&1 || true
  wait "$app_pid" 2>/dev/null || true
  cleanup_mount
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
