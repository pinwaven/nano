#!/bin/sh
# Download the VDOM SDK that matches HBuilderX 5.26.2026091802.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CACHE="$ROOT/temp/xapp-android-sdk"
ARCHIVE="$CACHE/sdk-5.26.zip"
SDK="$CACHE/extracted/Android-uni-app-x-SDK@15075-5.26"
EXPECTED=3a97adb960eb753cc872983fd830e382cf7df7537b764e34b4d9220779a0af8b
if [ ! -f "$SDK/plugins/uts-kotlin-gradle-plugin-0.0.1.jar" ]; then
  mkdir -p "$CACHE"
  if [ ! -f "$ARCHIVE" ]; then
    curl -fL --retry 2 --connect-timeout 30 -o "$ARCHIVE.part" \
      'https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/Android/Android-uni-app-x-SDK@15075-5.26.zip'
    mv "$ARCHIVE.part" "$ARCHIVE"
  fi
  ACTUAL=$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')
  [ "$ACTUAL" = "$EXPECTED" ] || { echo "SDK checksum mismatch: remove $ARCHIVE and retry" >&2; exit 1; }
  unzip -qo "$ARCHIVE" -d "$CACHE/extracted"
fi
echo "$SDK"
