#!/usr/bin/env bash
# Launch the locally built OTelux desktop app.
#
# This is the "daily driver" path, not a full electron-builder package. The script:
#   • rebuilds the desktop bundle (unless --no-build),
#   • runs the unpackaged build with Electron,
#   • keeps Electron profile data under ~/.config/otelux/local,
#   • stores OTelux telemetry/settings under the canonical OS data home,
#   • forwards the window icon via the same build/icon.png that
#     electron-builder uses for packaged AppImages.
#
# Usage:
#   ./otelux.sh                       # build + launch
#   ./otelux.sh --no-build            # skip the rebuild, launch what's there
#   ./otelux.sh --port 4399           # override the OTLP port for this run
#   ./otelux.sh --install-desktop     # install a ~/.local desktop entry
#                                     # so the app can be pinned / launched
#                                     # from the system launcher
#   ./otelux.sh --install-desktop-only # install the entry without launching
#   PORT=4399 ./otelux.sh             # same as --port
#
# Any extra arguments after a `--` are forwarded to electron, e.g.
#   ./otelux.sh -- --remote-debugging-port=19222
#
# Requires: node + npm (build), and electron (already a devDependency).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="${REPO_ROOT}/apps/desktop"
MAIN_ENTRY="${DESKTOP_DIR}/out/main/index.js"
ICON_PNG="${DESKTOP_DIR}/build/icon.png"
ELECTRON_BIN="${REPO_ROOT}/node_modules/.bin/electron"
ELECTRON_USER_DATA_DIR="${OTELUX_USER_DATA_DIR:-${XDG_CONFIG_HOME:-${HOME}/.config}/otelux/local}"
RUNTIME_DATA_DIR="${OTELUX_DATA_DIR:-${XDG_DATA_HOME:-${HOME}/.local/share}/otelux}"

# Use a stable WM_CLASS so the running window matches the .desktop file
# installed via --install-desktop. Linux WMs pin by WM_CLASS, not by
# process name, so this has to be set on every launch — packaged builds
# get it via electron-builder; we set it explicitly here.
WM_CLASS="OTelux"

DO_BUILD=1
DO_INSTALL=0
DO_LAUNCH=1
PORT_OVERRIDE=""
FORWARD_ARGS=()

desktop_exec_quote() {
	local value="$1"
	# Desktop Entry values process string escapes before Exec argument
	# quoting, so a literal backslash inside a quoted argument needs four
	# backslashes. Percent signs use a separate field-code grammar and must
	# be doubled to remain literal.
	value="${value//\\/\\\\\\\\}"
	value="${value//\"/\\\"}"
	value="${value//\`/\\\`}"
	value="${value//\$/\\\$}"
	value="${value//\%/%%}"
	printf '"%s"' "${value}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		-n|--no-build)
			DO_BUILD=0
			shift
			;;
		--install-desktop)
			DO_INSTALL=1
			shift
			;;
		--install-desktop-only)
			DO_INSTALL=1
			DO_LAUNCH=0
			shift
			;;
		--port)
			PORT_OVERRIDE="$2"
			shift 2
			;;
		--port=*)
			PORT_OVERRIDE="${1#--port=}"
			shift
			;;
		-h|--help)
			sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		--)
			shift
			FORWARD_ARGS+=("$@")
			break
			;;
		*)
			echo "error: unknown argument '$1' (try --help)" >&2
			exit 2
			;;
	esac
done

install_desktop_entry() {
	# Drop a .desktop file under ~/.local/share/applications so Linux
	# launchers (GNOME Activities, KDE Krunner, Plasma, sway/wofi, etc.)
	# pick up the app. The Exec= line points at this same script with
	# --no-build, so launching from the WM is fast and uses whatever
	# bundle was last built. Icon is installed at the hicolor 512x512
	# size, which most launchers prefer for application icons.
	local apps_dir="${XDG_DATA_HOME:-${HOME}/.local/share}/applications"
	local icons_dir="${XDG_DATA_HOME:-${HOME}/.local/share}/icons/hicolor/512x512/apps"
	local desktop_file="${apps_dir}/otelux-local.desktop"
	local installed_icon="${icons_dir}/otelux-local.png"
	local launcher_path
	launcher_path="$(desktop_exec_quote "${REPO_ROOT}/otelux.sh")"

	mkdir -p "${apps_dir}" "${icons_dir}"

	if [[ ! -f "${ICON_PNG}" ]]; then
		echo "error: icon missing at ${ICON_PNG}. Run ./scripts/build-icons.sh first." >&2
		exit 1
	fi
	cp "${ICON_PNG}" "${installed_icon}"

	cat > "${desktop_file}" <<EOF
[Desktop Entry]
Type=Application
Name=OTelux (local)
Comment=Local OpenTelemetry workbench (locally built)
Exec=${launcher_path} --no-build
Icon=otelux-local
StartupNotify=true
StartupWMClass=${WM_CLASS}
Terminal=false
Categories=Development;
Keywords=OpenTelemetry;OTLP;tracing;traces;observability;
EOF

	# Refresh the desktop database so the new entry shows up immediately
	# on GNOME / KDE. Silent on systems that don't ship the tool.
	command -v update-desktop-database >/dev/null 2>&1 && \
		update-desktop-database "${apps_dir}" >/dev/null 2>&1 || true

	echo "installed: ${desktop_file}"
	echo "installed: ${installed_icon}"
	echo "tip: search for 'OTelux' in your launcher, or pin it from the dock."
}

if [[ ${DO_INSTALL} -eq 1 ]]; then
	install_desktop_entry
	# Falls through so --install-desktop also launches the app, mirroring
	# the "build + run" flow. --install-desktop-only exits here instead.
	if [[ ${DO_LAUNCH} -eq 0 ]]; then
		exit 0
	fi
fi

if [[ ${DO_BUILD} -eq 1 ]]; then
	echo "[otelux] building workspace bundles…"
	# Use the root-level turbo build so `@otelux/ui` (and any other
	# upstream workspace) is rebuilt before `@otelux/desktop` bundles
	# the renderer. Running the desktop build alone would leave a
	# stale `packages/ui/dist/` and the app would load an old UI.
	npm run --silent build
fi

if [[ ! -f "${MAIN_ENTRY}" ]]; then
	echo "error: ${MAIN_ENTRY} missing. Run without --no-build, or 'npm run build'." >&2
	exit 1
fi
if [[ ! -x "${ELECTRON_BIN}" ]]; then
	echo "error: electron binary missing at ${ELECTRON_BIN}. Run 'npm install'." >&2
	exit 1
fi
if [[ ! -f "${ICON_PNG}" ]]; then
	echo "warn: ${ICON_PNG} missing — window icon may be blank. Run ./scripts/build-icons.sh." >&2
fi

# Resolve the OTLP port. Precedence: --port flag > $PORT > $OTELUX_OTLP_PORT
# > whatever the app's persisted settings say.
if [[ -n "${PORT_OVERRIDE}" ]]; then
	export OTELUX_OTLP_PORT="${PORT_OVERRIDE}"
elif [[ -n "${PORT:-}" ]]; then
	export OTELUX_OTLP_PORT="${PORT}"
fi

mkdir -p "${ELECTRON_USER_DATA_DIR}" "${RUNTIME_DATA_DIR}"
export OTELUX_DATA_DIR="${RUNTIME_DATA_DIR}"

# `--class` sets WM_CLASS so the running window groups under the
# installed .desktop entry on Linux (GNOME/KDE/sway all key off WM_CLASS).
# `app.isPackaged` (in main/index.ts) decides dev-only behavior, so we do
# not need to set NODE_ENV here — the build was already produced by
# electron-vite in production mode.
#
# `"${FORWARD_ARGS[@]+"${FORWARD_ARGS[@]}"}"` expands to nothing when the
# array is empty (avoids a `set -u` "unbound variable" error on bash 4).
exec "${ELECTRON_BIN}" \
	"${MAIN_ENTRY}" \
	--user-data-dir="${ELECTRON_USER_DATA_DIR}" \
	--class="${WM_CLASS}" \
	${FORWARD_ARGS[@]+"${FORWARD_ARGS[@]}"}
