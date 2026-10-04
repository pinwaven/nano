#!/bin/sh
# Build src/xapp for the web (uni-app x H5 target) with HBuilderX's own compiler.
#
# `xcli publish web` needs a DCloud-registered manifest appid, and on Linux `xcli launch web`
# stops its dev server the moment the compile finishes. This runs the exact command and
# environment `xcli launch web` spawns (captured from /proc on HBuilderX 5.26), in build mode,
# so it needs neither. Output: src/xapp/unpackage/dist/build/web (git-ignored).
#
#   tools/xapp-web/build.sh            # production build
#   HBX=/path/to/HBuilderX tools/xapp-web/build.sh
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
X="$ROOT/src/xapp"
HBX=${HBX:-$HOME/HBuilderX}
PLUGIN="$HBX/plugins/uniapp-cli-vite"
[ -d "$PLUGIN" ] || { echo "HBuilderX not found at $HBX (set HBX=)"; exit 1; }

# The web build is styled by the web user-app's stylesheet (see src/xapp/static/web/
# xapp-web.css), regenerated every build into a git-ignored file.
node "$ROOT/tools/xapp-web/sync-css.mjs"

# Deps (vue, @dcloudio/*) resolve from the plugin's node_modules, so run from there.
cd "$PLUGIN"
exec env -i PATH="$HBX/plugins/node:/usr/bin:/bin" HOME="$HOME" LD_LIBRARY_PATH="$HBX" \
  NODE_SKIP_PLATFORM_CHECK=1 HBUILDER_EXTENSIONS_DIR="$HBX/plugins" HX_Version=5.26 \
  NODE_ENV=production UNI_PLATFORM=h5 UNI_UTS_PLATFORM=web \
  UNI_INPUT_DIR="$X" UNI_OUTPUT_DIR="$X/unpackage/dist/build/web" \
  HX_DEPENDENCIES_DIR="$X/unpackage/cache/uts_cache" UNI_APP_X_CACHE_DIR="$X/unpackage/cache/.web" \
  UNI_HBUILDERX_LANGID=en UNI_CLOUD_SPACES='[]' NO_COLOR=true \
  "$HBX/plugins/node/node" --no-warnings "$PLUGIN/node_modules/@dcloudio/vite-plugin-uni/bin/uni.js" build -p h5
