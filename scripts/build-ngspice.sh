#!/usr/bin/env bash
set -euo pipefail

# Builds the pinned shared ngspice library for the current host and stages it
# as a Tauri resource. The resulting binaries are intentionally gitignored.
#
# Cross-compiling ngspice is deliberately out of scope here: run this script on
# every target platform so the resource and Tau binary have a matching ABI.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${NGSPICE_SOURCE_DIR:-$ROOT/build/ngspice-src}"
BUILD_DIR="${NGSPICE_BUILD_DIR:-$ROOT/build/ngspice-build}"
STAGE_DIR="${NGSPICE_STAGE_DIR:-$ROOT/build/ngspice-stage}"
RESOURCE_DIR="$ROOT/apps/desktop/src-tauri/resources/ngspice"
NGSPICE_COMMIT="${NGSPICE_COMMIT:-67fbaa9e6a6d756fa23bf52c7b565fbe926fb9c6}"
NGSPICE_REPOSITORY="${NGSPICE_REPOSITORY:-https://git.code.sf.net/p/ngspice/ngspice}"

case "$(uname -s)" in
  Darwin)
    ENGINE_LIBRARY="libngspice.dylib"
    LIBRARY_GLOB="libngspice*.dylib"
    ;;
  Linux)
    ENGINE_LIBRARY="libngspice.so"
    LIBRARY_GLOB="libngspice*.so*"
    ;;
  *)
    echo "This build script supports native macOS and Linux builds only. Build ngspice with your Windows toolchain and stage ngspice.dll under apps/desktop/src-tauri/resources/ngspice/lib/." >&2
    exit 1
    ;;
esac

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

die() {
  echo "$*" >&2
  exit 1
}

# Keep the native engine's loader metadata in lockstep with the desktop app.
# Tauri owns the supported macOS floor, so do not duplicate it in this script.
tauri_macos_minimum_system_version() {
  node - "$ROOT/apps/desktop/src-tauri/tauri.conf.json" <<'NODE'
const fs = require("fs");
const path = process.argv[2];
const config = JSON.parse(fs.readFileSync(path, "utf8"));
const target = config?.bundle?.macOS?.minimumSystemVersion;
if (typeof target !== "string" || !/^\d+(?:\.\d+){0,2}$/.test(target)) {
  throw new Error(`${path} must declare bundle.macOS.minimumSystemVersion as a numeric version`);
}
process.stdout.write(target);
NODE
}

macos_version_key() {
  local version="$1" major minor patch extra
  [[ "$version" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || die "Invalid macOS deployment target: $version"
  IFS=. read -r major minor patch extra <<<"$version"
  minor="${minor:-0}"
  patch="${patch:-0}"
  printf '%d.%d.%d\n' "$((10#$major))" "$((10#$minor))" "$((10#$patch))"
}

# Remove every explicit -mmacosx-version-min flag from a compiler flag string,
# reject a conflicting value, then append the one target that Tauri declares.
# configure treats these as shell-style flag strings, so its normal word
# splitting is the representation we must normalize here as well.
normalize_macos_min_flags() {
  local flags="$1" target="$2" token value="" awaiting_value=0
  local -a kept=()
  local target_key
  target_key="$(macos_version_key "$target")"

  for token in $flags; do
    if (( awaiting_value )); then
      value="$token"
      awaiting_value=0
    else
      case "$token" in
        -mmacosx-version-min=*) value="${token#-mmacosx-version-min=}" ;;
        -mmacosx-version-min) awaiting_value=1; continue ;;
        *) kept+=("$token"); continue ;;
      esac
    fi

    if [[ "$(macos_version_key "$value")" != "$target_key" ]]; then
      die "Conflicting -mmacosx-version-min=$value (Tau declares $target)."
    fi
    value=""
  done
  (( awaiting_value == 0 )) || die "-mmacosx-version-min needs a version value."

  kept+=("-mmacosx-version-min=$target")
  (IFS=' '; printf '%s' "${kept[*]}")
}

for command in git make cc perl autoconf autoheader autom4te automake aclocal; do
  require_command "$command"
done

# Keep the configure environment defined on Linux too; the Darwin branch below
# rewrites these values to contain exactly one deployment-minimum flag.
CFLAGS="${CFLAGS:-}"
CPPFLAGS="${CPPFLAGS:-}"
LDFLAGS="${LDFLAGS:-}"

if [[ "$(uname -s)" == "Darwin" ]]; then
  require_command node
  TAU_MACOS_DEPLOYMENT_TARGET="$(tauri_macos_minimum_system_version)"
  target_key="$(macos_version_key "$TAU_MACOS_DEPLOYMENT_TARGET")"
  if [[ -n "${MACOSX_DEPLOYMENT_TARGET:-}" ]] &&
    [[ "$(macos_version_key "$MACOSX_DEPLOYMENT_TARGET")" != "$target_key" ]]; then
    die "Conflicting MACOSX_DEPLOYMENT_TARGET=$MACOSX_DEPLOYMENT_TARGET (Tau declares $TAU_MACOS_DEPLOYMENT_TARGET)."
  fi

  # Export before autogen/configure/make. Autoconf helper programs and every
  # compiler/link invocation now agree with the app bundle's declared floor.
  export MACOSX_DEPLOYMENT_TARGET="$TAU_MACOS_DEPLOYMENT_TARGET"
  CFLAGS="$(normalize_macos_min_flags "${CFLAGS:-}" "$TAU_MACOS_DEPLOYMENT_TARGET")"
  CPPFLAGS="$(normalize_macos_min_flags "${CPPFLAGS:-}" "$TAU_MACOS_DEPLOYMENT_TARGET")"
  LDFLAGS="$(normalize_macos_min_flags "${LDFLAGS:-}" "$TAU_MACOS_DEPLOYMENT_TARGET")"
  export CFLAGS CPPFLAGS LDFLAGS
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  require_command glibtoolize
else
  require_command libtoolize
fi

build_jobs() {
  if command -v nproc >/dev/null 2>&1; then
    nproc
  elif command -v sysctl >/dev/null 2>&1; then
    sysctl -n hw.ncpu
  elif command -v getconf >/dev/null 2>&1; then
    getconf _NPROCESSORS_ONLN
  else
    printf '4\n'
  fi
}

# Some older Homebrew autotools packages embed the removed /usr/bin/perl5.30
# interpreter in their shebang. Repair that only inside our disposable build
# tool directory rather than mutating the user's Homebrew installation.
AUTOTOOLS_BIN="$ROOT/build/ngspice-autotools-bin"
prepare_autotools_path() {
  rm -rf "$AUTOTOOLS_BIN"
  mkdir -p "$AUTOTOOLS_BIN"
  local tool executable shebang interpreter
  for tool in autoconf autoheader autom4te automake aclocal glibtoolize libtoolize; do
    executable="$(command -v "$tool" 2>/dev/null || true)"
    [[ -n "$executable" ]] || continue
    shebang="$(head -n 1 "$executable" 2>/dev/null || true)"
    interpreter="${shebang#\#!}"
    if [[ "$shebang" == '#!'*perl* && ! -x "$interpreter" ]]; then
      printf '#!/usr/bin/env bash\nexec %q %q "$@"\n' "$(command -v perl)" "$executable" >"$AUTOTOOLS_BIN/$tool"
      chmod +x "$AUTOTOOLS_BIN/$tool"
    else
      ln -s "$executable" "$AUTOTOOLS_BIN/$tool"
    fi
  done
}

if [[ -x /opt/homebrew/opt/bison/bin/bison ]]; then
  BISON_DIR="/opt/homebrew/opt/bison/bin"
elif command -v bison >/dev/null 2>&1; then
  BISON_DIR="$(dirname "$(command -v bison)")"
else
  echo "ngspice needs GNU Bison 3.x. Install it first (for macOS: brew install bison)." >&2
  exit 1
fi

if ! "$BISON_DIR/bison" --version | head -1 | grep -Eq ' 3\.'; then
  echo "ngspice needs GNU Bison 3.x; found: $($BISON_DIR/bison --version | head -1)" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  mkdir -p "$(dirname "$SOURCE_DIR")"
  git clone --no-checkout "$NGSPICE_REPOSITORY" "$SOURCE_DIR"
fi

git -C "$SOURCE_DIR" fetch --quiet --force origin "$NGSPICE_COMMIT"
git -C "$SOURCE_DIR" checkout --quiet --detach --force "$NGSPICE_COMMIT"
if [[ "$(git -C "$SOURCE_DIR" rev-parse HEAD)" != "$NGSPICE_COMMIT" ]]; then
  echo "ngspice checkout did not resolve to the pinned commit $NGSPICE_COMMIT." >&2
  exit 1
fi

# The pinned upstream OTA code model carries LTspice-compatible noise
# parameters but its deterministic transfer is unbounded and therefore cannot
# execute vendor macromodels that rely on LTspice's documented Iout/tanh limit.
# Keep the small auditable delta in-repo and fail if the pinned source ever
# drifts enough that it no longer applies cleanly.
OTA_PATCH="$ROOT/scripts/patches/ngspice-ltspice-ota-current-limit.patch"
if ! git -C "$SOURCE_DIR" apply --check "$OTA_PATCH"; then
  echo "The pinned ngspice OTA compatibility patch no longer applies cleanly." >&2
  exit 1
fi
git -C "$SOURCE_DIR" apply "$OTA_PATCH"

rm -rf "$BUILD_DIR" "$STAGE_DIR"
mkdir -p "$BUILD_DIR" "$STAGE_DIR"
prepare_autotools_path

# The upstream Git checkout intentionally excludes generated configure files.
# Recreate them from the pinned source on every build so a prior checkout
# cannot leak a stale configure script into a release.
pushd "$SOURCE_DIR" >/dev/null
PATH="$BISON_DIR:$AUTOTOOLS_BIN:$PATH" \
  AUTOM4TE="$AUTOTOOLS_BIN/autom4te" \
  ./autogen.sh
popd >/dev/null

EXTRA_CFLAGS=""
EXTRA_LDFLAGS=""
if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
  if NCURSES_PREFIX="$(brew --prefix ncurses 2>/dev/null)" && [[ -d "$NCURSES_PREFIX" ]]; then
    EXTRA_CFLAGS="-I$NCURSES_PREFIX/include"
    EXTRA_LDFLAGS="-L$NCURSES_PREFIX/lib"
  fi
fi

pushd "$BUILD_DIR" >/dev/null
# XSPICE is on by default at the pinned commit, so --enable-xspice changes
# nothing today. It is passed because it is the difference between an engine
# that can run a digital part and one that cannot, and that has been an opt-in
# upstream before: the flag states the requirement rather than inheriting it.
PATH="$BISON_DIR:$AUTOTOOLS_BIN:$PATH" \
  CFLAGS="$CFLAGS -O2 -fPIC $EXTRA_CFLAGS" \
  CPPFLAGS="$CPPFLAGS" \
  LDFLAGS="$LDFLAGS $EXTRA_LDFLAGS" \
  "$SOURCE_DIR/configure" \
    --with-ngshared \
    --enable-xspice \
    --enable-relpath \
    --disable-debug \
    --disable-openmp \
    --prefix="$STAGE_DIR"
PATH="$BISON_DIR:$AUTOTOOLS_BIN:$PATH" make -j"$(build_jobs)" install
popd >/dev/null

rm -rf "$RESOURCE_DIR"
mkdir -p "$RESOURCE_DIR/lib"
shopt -s nullglob
libraries=("$STAGE_DIR/lib"/$LIBRARY_GLOB)
if (( ${#libraries[@]} == 0 )); then
  echo "ngspice install did not produce $LIBRARY_GLOB under $STAGE_DIR/lib." >&2
  exit 1
fi
cp -RP "${libraries[@]}" "$RESOURCE_DIR/lib/"
shopt -u nullglob
# XSPICE code models are separate .cm modules loaded at run time. Without them
# the library still solves every analog circuit, so an install that produced
# none looks healthy here, while each digital or behavioral A device - Tau emits
# them for D flip-flop, sample-and-hold and modulator parts - fails at run time
# as an unknown model type. This stayed a warning for as long as it was a bare
# directory test, which is how a resource carrying no code models at all went
# unnoticed. Every name the engine loader asks for is required, so a partial
# code-model build is caught here rather than one device at a time in the app.
missing_codemodels=()
for codemodel in spice2poly analog digital xtradev xtraevt tlines; do
  if [[ ! -f "$STAGE_DIR/lib/ngspice/$codemodel.cm" ]]; then
    missing_codemodels+=("$codemodel.cm")
  fi
done
if (( ${#missing_codemodels[@]} > 0 )); then
  echo "ngspice install is missing XSPICE code models under $STAGE_DIR/lib/ngspice: ${missing_codemodels[*]}. Tau cannot simulate digital or behavioral A devices without them." >&2
  exit 1
fi
cp -R "$STAGE_DIR/lib/ngspice" "$RESOURCE_DIR/lib/"
# ngspice's `table` code model is the one part of the engine under GPL v2
# instead of Modified BSD. Tau emits no device that uses it, so it is dropped
# from the resource rather than shipped: distributing it would put the whole
# product under the GPL for no capability, and THIRD_PARTY_NOTICES states that
# Tau carries no GPL code. It is absent from the required list above for the
# same reason, and the loader's list must not name it either.
rm -f "$RESOURCE_DIR/lib/ngspice/table.cm"
# The `d_cosim` co-simulation tool chain is the other place GPL code enters the
# build: `ivlng.vpi` is built from `src/xspice/verilog/vpi.c` and the installed
# shim sources include `ghdl_vpi.c`, both GPL v2 or later. The rest of the tool
# chain is Modified BSD but goes with them, because Tau emits no `d_cosim`
# device and offers no Verilog or VHDL co-simulation.
rm -f "$RESOURCE_DIR/lib/ngspice/ivlng.so" "$RESOURCE_DIR/lib/ngspice/ivlng.vpi"
if [[ -d "$STAGE_DIR/share/ngspice" ]]; then
  mkdir -p "$RESOURCE_DIR/share"
  cp -R "$STAGE_DIR/share/ngspice" "$RESOURCE_DIR/share/"
  rm -rf "$RESOURCE_DIR/share/ngspice/scripts/src"
  rm -f "$RESOURCE_DIR/share/ngspice/scripts/ghnggen" \
    "$RESOURCE_DIR/share/ngspice/scripts/vlnggen"
fi
touch "$RESOURCE_DIR/.gitkeep"

if [[ ! -e "$RESOURCE_DIR/lib/$ENGINE_LIBRARY" ]]; then
  echo "Staged resource is missing $ENGINE_LIBRARY." >&2
  exit 1
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  real_library="$RESOURCE_DIR/lib/libngspice.0.dylib"
  if [[ ! -f "$real_library" ]]; then
    real_library="$(find "$RESOURCE_DIR/lib" -maxdepth 1 -type f -name 'libngspice*.dylib' -print -quit)"
  fi
  if [[ -z "$real_library" || ! -f "$real_library" ]]; then
    echo "Could not identify the real staged macOS ngspice library." >&2
    exit 1
  fi
  install_name_tool -id "@rpath/$(basename "$real_library")" "$real_library"
  codesign --force --sign - "$real_library" >/dev/null
  if otool -L "$real_library" | grep -Fq "$STAGE_DIR"; then
    echo "Staged ngspice still references the temporary build directory." >&2
    exit 1
  fi
fi

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Bind every packaged engine resource (including the loader-facing library
# symlink) to this record. The packaging check also requires exact set equality,
# so an injected file and a removed file are both fatal instead of merely going
# unhashed.
{
  printf '{\n'
  printf '  "repository": "%s",\n' "$NGSPICE_REPOSITORY"
  printf '  "commit": "%s",\n' "$NGSPICE_COMMIT"
  printf '  "host": "%s-%s",\n' "$(uname -s)" "$(uname -m)"
  printf '  "library": "lib/%s",\n' "$ENGINE_LIBRARY"
  printf '  "files": {\n'
  first_digest=1
  while IFS= read -r resource; do
    relative="${resource#"$RESOURCE_DIR/"}"
    [[ "$relative" == ".gitkeep" || "$relative" == "build-info.json" ]] && continue
    digest="$(hash_file "$resource")"
    if (( first_digest == 0 )); then
      printf ',\n'
    fi
    first_digest=0
    printf '    "%s": "%s"' "$relative" "$digest"
  done < <(find "$RESOURCE_DIR" \( -type f -o -type l \) -print | LC_ALL=C sort)
  printf '\n  }\n}\n'
} >"$RESOURCE_DIR/build-info.json"

echo "Bundled ngspice resource prepared at $RESOURCE_DIR (commit $NGSPICE_COMMIT)"
