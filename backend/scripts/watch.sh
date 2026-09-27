#!/usr/bin/env bash
# Build / simulate the Connect IQ watch app without VS Code.
#   pnpm watch:build     compile connectiq/ for the Forerunner 265 -> connectiq/bin/vitalsync.prg
#   pnpm watch:sim       build, open the Garmin simulator, and run the app in it
#   pnpm watch:install   build and copy onto a USB-connected watch (needs: brew install libmtp)
set -euo pipefail

CIQ="$HOME/Library/Application Support/Garmin/ConnectIQ"
SDK="${CIQ_SDK:-$(sed 's:/*$::' "$CIQ/current-sdk.cfg" 2>/dev/null || true)}"
KEY="${CIQ_KEY:-$HOME/.garmin/developer_key.der}"
DEVICE="${CIQ_DEVICE:-fr265}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/connectiq/bin/vitalsync.prg"

[ -x "$SDK/bin/monkeyc" ] || { echo "Connect IQ SDK not found. Install it with the SDK Manager."; exit 1; }
[ -f "$KEY" ] || { echo "Developer key not found at $KEY"; exit 1; }
[ -d "$CIQ/Devices/$DEVICE" ] || { echo "Device '$DEVICE' not downloaded. Get it in SDK Manager -> Devices."; exit 1; }

build() {
  mkdir -p "$(dirname "$OUT")"
  echo "Building for ${DEVICE}..."
  (cd "$ROOT/connectiq" && "$SDK/bin/monkeyc" -f monkey.jungle -d "$DEVICE" -o "$OUT" -y "$KEY" -w)
  echo "Built $OUT"
}

sim() {
  build
  if ! pgrep -f "ConnectIQ.app/Contents/MacOS" >/dev/null; then
    echo "Opening the simulator..."
    open "$SDK/bin/ConnectIQ.app"
    for _ in $(seq 1 30); do pgrep -f "ConnectIQ.app/Contents/MacOS" >/dev/null && break; sleep 1; done
    sleep 3
  fi
  echo "Loading the app into the simulator..."
  "$SDK/bin/monkeydo" "$OUT" "$DEVICE" &
  echo "The app is running in the simulator window. Press START (click the top-right button or press Enter) to pair."
}

install() {
  build
  command -v mtp-folders >/dev/null || { echo "Install libmtp first: brew install libmtp"; exit 1; }
  pkill -x OpenMTP 2>/dev/null || true  # OpenMTP holds the USB connection
  echo "Looking for the watch over USB..."
  local apps
  apps=$(LANG=en_US.UTF-8 mtp-folders 2>/dev/null | awk -F'\t' '$2 ~ /^  Apps$/ {print $1; exit}')
  [ -n "$apps" ] || { echo "Watch not found. Plug it in, unlock it, and close Garmin Express."; exit 1; }
  echo "Copying to GARMIN/Apps (folder $apps)..."
  LANG=en_US.UTF-8 python3 "$ROOT/scripts/mtp-send.py" "$OUT" "$apps" VITALSYNC.PRG
  echo "Done. Unplug the watch; VitalSync appears in its apps list."
}

case "${1:-build}" in
  build) build ;;
  sim) sim ;;
  install) install ;;
  *) echo "usage: $0 [build|sim|install]"; exit 1 ;;
esac
