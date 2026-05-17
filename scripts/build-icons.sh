#!/usr/bin/env bash
# Rasterize apps/desktop/build/icon.svg to the PNG sizes electron-builder
# expects. Re-run after edits to icon.svg.
#
# Linux: electron-builder picks up any PNG named build/icon.png (>=512px)
#   and synthesizes the rest. We additionally emit a 16/32/64/128/256/512
#   set under build/icons/ so packagers that want a directory tree (e.g.
#   `linux.icon: build/icons`) can use it.
# macOS / Windows: we emit a 1024x1024 master so future .icns/.ico
#   generation has a high-resolution source. The .icns and .ico files
#   themselves are generated lazily by electron-builder from icon.png
#   when those targets are built.
#
# Requires rsvg-convert (librsvg). Install via:
#   apt:   sudo apt install librsvg2-bin
#   brew:  brew install librsvg
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC="${REPO_ROOT}/apps/desktop/build/icon.svg"
OUT_DIR="${REPO_ROOT}/apps/desktop/build"
ICONS_DIR="${OUT_DIR}/icons"

if ! command -v rsvg-convert >/dev/null 2>&1; then
	echo "error: rsvg-convert not found. Install librsvg (apt: librsvg2-bin, brew: librsvg)." >&2
	exit 1
fi

if [[ ! -f "${SRC}" ]]; then
	echo "error: missing master SVG at ${SRC}" >&2
	exit 1
fi

mkdir -p "${ICONS_DIR}"

# Primary icon used by electron-builder. 512x512 is the documented minimum
# for the AppImage target on Linux.
rsvg-convert -w 512 -h 512 "${SRC}" -o "${OUT_DIR}/icon.png"

# High-resolution master for future .icns/.ico generation.
rsvg-convert -w 1024 -h 1024 "${SRC}" -o "${OUT_DIR}/icon@1024.png"

# Size set for Linux desktop integration (`build/icons/<size>x<size>.png`).
for size in 16 32 48 64 128 256 512; do
	rsvg-convert -w "${size}" -h "${size}" "${SRC}" \
		-o "${ICONS_DIR}/${size}x${size}.png"
done

echo "wrote: ${OUT_DIR}/icon.png (512x512)"
echo "wrote: ${OUT_DIR}/icon@1024.png (1024x1024)"
echo "wrote: ${ICONS_DIR}/{16,32,48,64,128,256,512}x{...}.png"
