#!/usr/bin/env bash
# Verify that every packaged Mach-O honours Tau's declared macOS floor.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/apps/desktop/src-tauri/tauri.conf.json"
APP="$ROOT/apps/desktop/src-tauri/target/release/bundle/macos/Tau.app"
REQUIRE_MACOS=""

usage() {
  echo "Usage: $0 [path/to/Tau.app] [--require-macos]" >&2
  exit 64
}

if [[ "${1:-}" == "--require-macos" ]]; then
  REQUIRE_MACOS="$1"
  shift
fi
if [[ $# -gt 0 ]]; then
  APP="$1"
  shift
fi
if [[ "${1:-}" == "--require-macos" ]]; then
  [[ -z "$REQUIRE_MACOS" ]] || usage
  REQUIRE_MACOS="$1"
  shift
fi
[[ $# -eq 0 ]] || usage

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "MACOS-DEPLOYMENT-TARGET: skipped (requires macOS Mach-O tooling)"
  [[ "$REQUIRE_MACOS" != "--require-macos" ]] || {
    echo "MACOS-DEPLOYMENT-TARGET: --require-macos was requested on a non-macOS host" >&2
    exit 1
  }
  exit 0
fi

die() {
  echo "MACOS-DEPLOYMENT-TARGET: $*" >&2
  exit 1
}

macos_version_key() {
  local version="$1" major minor patch extra
  [[ "$version" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || die "invalid macOS version: $version"
  IFS=. read -r major minor patch extra <<<"$version"
  minor="${minor:-0}"
  patch="${patch:-0}"
  printf '%d.%d.%d\n' "$((10#$major))" "$((10#$minor))" "$((10#$patch))"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_command node
require_command file
require_command xcrun
xcrun --find vtool >/dev/null 2>&1 || die "Xcode vtool is unavailable"
xcrun --find lipo >/dev/null 2>&1 || die "Xcode lipo is unavailable"

TARGET="$(node - "$CONFIG" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const config = JSON.parse(fs.readFileSync(path, "utf8"));
const target = config?.bundle?.macOS?.minimumSystemVersion;
if (typeof target !== "string" || !/^\d+(?:\.\d+){0,2}$/.test(target)) {
  throw new Error(`${path} must declare bundle.macOS.minimumSystemVersion as a numeric version`);
}
process.stdout.write(target);
NODE
)"
TARGET_KEY="$(macos_version_key "$TARGET")"
EXPECTED_ARCH="${TAU_EXPECTED_ARCH:-$(uname -m)}"
case "$EXPECTED_ARCH" in
  arm64|x86_64) ;;
  *) die "unsupported expected architecture: $EXPECTED_ARCH" ;;
esac

[[ -d "$APP" ]] || die "Tau.app is missing: $APP"

required=(
  "$APP/Contents/MacOS/tau"
  "$APP/Contents/Resources/ngspice/lib/libngspice.dylib"
  "$APP/Contents/Resources/ngspice/lib/libngspice.0.dylib"
)
for module in analog digital spice2poly tlines xtradev xtraevt; do
  required+=("$APP/Contents/Resources/ngspice/lib/ngspice/$module.cm")
done
for required_file in "${required[@]}"; do
  [[ -e "$required_file" ]] || die "required native payload is missing: ${required_file#$APP/}"
done

checked=0
check_macho() {
  local path="$1" relative archs build_info platform minos
  relative="${path#$APP/}"
  file -b "$path" | grep -q 'Mach-O' || die "$relative is not a Mach-O binary"

  archs="$(xcrun lipo -archs "$path")"
  [[ "$archs" == "$EXPECTED_ARCH" ]] ||
    die "$relative has architecture '$archs', expected '$EXPECTED_ARCH'"

  build_info="$(xcrun vtool -show-build "$path")" || die "vtool could not inspect $relative"
  platform="$(printf '%s\n' "$build_info" | awk '$1 == "platform" { print $2; exit }')"
  minos="$(printf '%s\n' "$build_info" | awk '$1 == "minos" { print $2; exit }')"
  [[ "$platform" == "MACOS" ]] || die "$relative targets '$platform', expected MACOS"
  [[ -n "$minos" ]] || die "$relative has no LC_BUILD_VERSION minimum OS"
  [[ "$(macos_version_key "$minos")" == "$TARGET_KEY" ]] ||
    die "$relative minimum macOS is $minos, expected $TARGET"
  checked=$((checked + 1))
}

# Scan the entire bundle so a newly-added framework or code model cannot evade
# the release gate. Required entries above make an empty/missing XSPICE tree a
# hard failure instead of a vacuous success.
while IFS= read -r path; do
  if file -b "$path" | grep -q 'Mach-O'; then
    check_macho "$path"
  fi
done < <(find "$APP" \( -type f -o -type l \) -print | LC_ALL=C sort)

(( checked > 0 )) || die "no Mach-O binaries found in Tau.app"
echo "MACOS-DEPLOYMENT-TARGET: ok target=$TARGET arch=$EXPECTED_ARCH files=$checked"
