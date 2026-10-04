#!/bin/sh
# Package src/xapp as a signed Android APK with HBuilderX, then copy it to
# dist/xapp/android/. HBuilderX keeps its intermediate files in src/xapp/unpackage/.
# Requires a registered manifest appid, a DCloud login, and a configured cloud certificate.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
X="$ROOT/src/xapp"
OUT="$ROOT/dist/xapp/android"
HBX=${HBX:-}
if [ -z "$HBX" ]; then
  if [ -x /Applications/HBuilderX.app/Contents/MacOS/cli ]; then
    HBX=/Applications/HBuilderX.app
  else
    HBX="$HOME/HBuilderX"
  fi
fi
case "$HBX" in
  *.app) CLI="$HBX/Contents/MacOS/cli" ;;
  *) CLI="$HBX/cli" ;;
esac
[ -x "$CLI" ] || { echo "HBuilderX CLI not found at $CLI (set HBX=)" >&2; exit 1; }

APPID=$(node -p "require(process.argv[1]).appid || ''" "$X/manifest.json")
PACKAGE=$(node -p "require(process.argv[1]).app?.distribute?.android?.packagename || ''" "$X/manifest.json")
[ -n "$APPID" ] || { echo "Set a registered DCloud appid in src/xapp/manifest.json before Android packaging" >&2; exit 1; }
[ -n "$PACKAGE" ] || { echo "Set app.distribute.android.packagename in src/xapp/manifest.json" >&2; exit 1; }

# A timestamp marker prevents an old APK in unpackage/release from passing as a new build.
MARKER=$(mktemp)
trap 'rm -f "$MARKER"' EXIT HUP INT TERM
"$CLI" pack --project "$X" --platform android --safemode true \
  --android.packagename "$PACKAGE" --android.androidpacktype 3

RELEASE="$X/unpackage/release"
APK=$(find "$RELEASE" -type f -name '*.apk' -newer "$MARKER" -print 2>/dev/null | sed -n '1p')
[ -n "$APK" ] || { echo "HBuilderX returned without a new APK in $RELEASE" >&2; exit 1; }
mkdir -p "$OUT"
cp "$APK" "$OUT/"
echo "xapp-android → ${OUT#$ROOT/}/$(basename "$APK")"
