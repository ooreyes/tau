#!/usr/bin/env bash
set -euo pipefail

# Builds the pinned shared ngspice library for the current host and stages it
# as a Tauri resource. The resulting binaries are intentionally gitignored.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${NGSPICE_SOURCE_DIR:-$ROOT/build/ngspice-src}"
STAGE_DIR="$ROOT/build/ngspice-stage"
RESOURCE_DIR="$ROOT/apps/desktop/src-tauri/resources/ngspice"
NGSPICE_COMMIT="${NGSPICE_COMMIT:-67fbaa9e6a6d756fa23bf52c7b565fbe926fb9c6}"

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
  git clone https://git.code.sf.net/p/ngspice/ngspice "$SOURCE_DIR"
fi

git -C "$SOURCE_DIR" fetch --quiet origin "$NGSPICE_COMMIT"
git -C "$SOURCE_DIR" checkout --quiet "$NGSPICE_COMMIT"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

EXTRA_CFLAGS=""
EXTRA_LDFLAGS=""
if [[ "$(uname -s)" == "Darwin" && -d /opt/homebrew/opt/ncurses ]]; then
  EXTRA_CFLAGS="-I/opt/homebrew/opt/ncurses/include"
  EXTRA_LDFLAGS="-L/opt/homebrew/opt/ncurses/lib"
fi

pushd "$SOURCE_DIR" >/dev/null
PATH="$BISON_DIR:$PATH" \
  CFLAGS="-O2 $EXTRA_CFLAGS" \
  LDFLAGS="$EXTRA_LDFLAGS" \
  ./configure --with-ngshared --enable-relpath --disable-debug --disable-openmp --prefix="$STAGE_DIR"
PATH="$BISON_DIR:$PATH" make -j"$(sysctl -n hw.ncpu 2>/dev/null || getconf _NPROCESSORS_ONLN)" install
popd >/dev/null

rm -rf "$RESOURCE_DIR"
mkdir -p "$RESOURCE_DIR/lib"
if [[ "$(uname -s)" == "Darwin" ]]; then
  cp -R "$STAGE_DIR/lib/libngspice"*.dylib "$RESOURCE_DIR/lib/"
else
  cp -R "$STAGE_DIR/lib/libngspice"*.so* "$RESOURCE_DIR/lib/"
fi
if [[ -d "$STAGE_DIR/lib/ngspice" ]]; then
  cp -R "$STAGE_DIR/lib/ngspice" "$RESOURCE_DIR/lib/"
fi
if [[ -d "$STAGE_DIR/share/ngspice" ]]; then
  mkdir -p "$RESOURCE_DIR/share"
  cp -R "$STAGE_DIR/share/ngspice" "$RESOURCE_DIR/share/"
fi
touch "$RESOURCE_DIR/.gitkeep"

echo "Bundled ngspice resource prepared at $RESOURCE_DIR"
