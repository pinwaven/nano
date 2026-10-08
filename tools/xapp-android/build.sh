#!/bin/sh
# Export xapp with HBuilderX, then build the APK locally with Gradle.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
X="$ROOT/src/xapp"
NATIVE="$ROOT/tools/xapp-android/native"
OUT="$ROOT/dist/xapp/android"
VARIANT=${1:-debug}
case "$VARIANT" in
  debug) TASK=assembleDebug ;;
  release)
    TASK=assembleRelease
    : "${XAPP_KEYSTORE:?Set XAPP_KEYSTORE for release signing}"
    : "${XAPP_STORE_PASSWORD:?Set XAPP_STORE_PASSWORD}"
    : "${XAPP_KEY_ALIAS:?Set XAPP_KEY_ALIAS}"
    : "${XAPP_KEY_PASSWORD:?Set XAPP_KEY_PASSWORD}"
    ;;
  *) echo "Usage: $0 [debug|release]" >&2; exit 1 ;;
esac
HBX=${HBX:-}
if [ -z "$HBX" ]; then
  if [ -x /Applications/HBuilderX.app/Contents/MacOS/cli ]; then
    HBX=/Applications/HBuilderX.app
  elif [ -x "$HOME/Applications/HBuilderX.app/Contents/MacOS/cli" ]; then
    HBX="$HOME/Applications/HBuilderX.app"
  elif [ -x "$HOME/HBuilderX/cli" ]; then
    HBX="$HOME/HBuilderX"
  else
    echo "HBuilderX not found. Checked /Applications/HBuilderX.app, $HOME/Applications/HBuilderX.app and $HOME/HBuilderX. Set HBX to your installation path." >&2
    exit 1
  fi
fi
case "$HBX" in
  *.app) CLI="$HBX/Contents/MacOS/cli" ;;
  *) CLI="$HBX/cli" ;;
esac
[ -x "$CLI" ] || { echo "HBuilderX CLI not found at $CLI (selected by HBX=$HBX; unset HBX to use automatic discovery)" >&2; exit 1; }
VERSION=$("$CLI" version | sed 's/\x1b\[[0-9;]*m//g' | tr -d '\r\n')
[ "$VERSION" = '5.26.2026091802' ] || { echo "Local SDK requires HBuilderX 5.26.2026091802; found $VERSION" >&2; exit 1; }
ANDROID_HOME=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}
[ -d "$ANDROID_HOME/platforms/android-35" ] || { echo "Install Android SDK platform 35 in $ANDROID_HOME" >&2; exit 1; }
export ANDROID_HOME
if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then
  JAVA_HOME=$(/usr/libexec/java_home -v 17)
  export JAVA_HOME
fi
SDK=$("$ROOT/tools/xapp-android/setup-sdk.sh")
node "$ROOT/tools/xapp-android/generate-native-styles.mjs"
# HBuilderX can return success without exporting; remove only its generated export first.
rm -rf "$X/unpackage/resources/app-android"
"$CLI" publish app-android --type appResource --project "$X"
node "$ROOT/tools/xapp-android/prepare-native.mjs" "$SDK"
"$NATIVE/gradlew" -p "$NATIVE" --console=plain "$TASK"
APK="$NATIVE/app/build/outputs/apk/$VARIANT/app-$VARIANT.apk"
[ -s "$APK" ] || { echo "Gradle did not produce $APK" >&2; exit 1; }
mkdir -p "$OUT"
cp "$APK" "$OUT/nano-xapp-$VARIANT.apk"
echo "xapp-android → dist/xapp/android/nano-xapp-$VARIANT.apk"
