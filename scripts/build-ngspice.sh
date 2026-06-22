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

for command in git make cc perl autoconf autoheader autom4te automake aclocal; do
  require_command "$command"
done

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
PATH="$BISON_DIR:$AUTOTOOLS_BIN:$PATH" \
  CFLAGS="${CFLAGS:-} -O2 -fPIC $EXTRA_CFLAGS" \
  LDFLAGS="${LDFLAGS:-} $EXTRA_LDFLAGS" \
  "$SOURCE_DIR/configure" \
    --with-ngshared \
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
if [[ -d "$STAGE_DIR/lib/ngspice" ]]; then
  cp -R "$STAGE_DIR/lib/ngspice" "$RESOURCE_DIR/lib/"
fi
if [[ -d "$STAGE_DIR/share/ngspice" ]]; then
  mkdir -p "$RESOURCE_DIR/share"
  cp -R "$STAGE_DIR/share/ngspice" "$RESOURCE_DIR/share/"
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

cat >"$RESOURCE_DIR/build-info.json" <<EOF
{
  "repository": "$NGSPICE_REPOSITORY",
  "commit": "$NGSPICE_COMMIT",
  "host": "$(uname -s)-$(uname -m)",
  "library": "lib/$ENGINE_LIBRARY"
}
EOF

echo "Bundled ngspice resource prepared at $RESOURCE_DIR (commit $NGSPICE_COMMIT)"
