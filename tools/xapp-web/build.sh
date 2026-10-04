#!/bin/sh
# Build src/xapp for the web (uni-app x H5 target) with HBuilderX's own compiler.
#
# `xcli publish web` needs a DCloud-registered manifest appid, and on Linux `xcli launch web`
# stops its dev server the moment the compile finishes. This runs the exact command and
# environment `xcli launch web` spawns (captured from /proc on HBuilderX 5.26), in build mode,
# so it needs neither. Output: dist/xapp/web (git-ignored).
#
#   tools/xapp-web/build.sh            # production build
#   HBX=/path/to/HBuilderX tools/xapp-web/build.sh
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
X="$ROOT/src/xapp"
OUT="$ROOT/dist/xapp/web"
HBX=${HBX:-}
if [ -z "$HBX" ]; then
  if [ -d /Applications/HBuilderX.app/Contents/HBuilderX/plugins/uniapp-cli-vite ]; then
    HBX=/Applications/HBuilderX.app
  else
    HBX="$HOME/HBuilderX"
  fi
fi
case "$HBX" in
  *.app) HBX_ROOT="$HBX/Contents/HBuilderX" ;;
  *) HBX_ROOT="$HBX" ;;
esac
PLUGIN="$HBX_ROOT/plugins/uniapp-cli-vite"
[ -d "$PLUGIN" ] || { echo "HBuilderX compiler not found at $PLUGIN (set HBX=)"; exit 1; }
mkdir -p "$(dirname "$OUT")"

# The web build is styled by the web user-app's stylesheet (see src/xapp/static/web/
# xapp-web.css), regenerated every build into a git-ignored file.
node "$ROOT/tools/xapp-web/sync-css.mjs"

# Deps (vue, @dcloudio/*) resolve from the plugin's node_modules, so run from there.
cd "$PLUGIN"
exec env -i PATH="$HBX_ROOT/plugins/node:/usr/bin:/bin" HOME="$HOME" LD_LIBRARY_PATH="$HBX_ROOT" \
  NODE_SKIP_PLATFORM_CHECK=1 HBUILDER_EXTENSIONS_DIR="$HBX_ROOT/plugins" HX_Version=5.26 \
  NODE_ENV=production UNI_PLATFORM=h5 UNI_UTS_PLATFORM=web \
  UNI_INPUT_DIR="$X" UNI_OUTPUT_DIR="$OUT" \
  HX_DEPENDENCIES_DIR="$X/unpackage/cache/uts_cache" UNI_APP_X_CACHE_DIR="$X/unpackage/cache/.web" \
  UNI_HBUILDERX_LANGID=en UNI_CLOUD_SPACES='[]' NO_COLOR=true \
  "$HBX_ROOT/plugins/node/node" --no-warnings "$PLUGIN/node_modules/@dcloudio/vite-plugin-uni/bin/uni.js" build -p h5
