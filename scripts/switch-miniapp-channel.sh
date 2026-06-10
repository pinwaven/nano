#!/bin/bash
# Usage: ./scripts/switch-miniapp-channel.sh <channel>
# Channels: nano (default/root), aeviva, fusion
# Copies the matching *.project.config.json into project.config.json so WeChat DevTools
# and CLI uploads target the correct miniprogram account.

set -e

MINIAPP_DIR="$(dirname "$0")/../src/mini/nano-miniapp"
CHANNEL="${1:-}"

case "$CHANNEL" in
  nano)
    CONFIG="nanovate.project.config.json"
    APPID="wx84bd7d00a6fd626e"
    ;;
  aeviva)
    CONFIG="aeviva.project.config.json"
    APPID="wxd19a1403c4fea89d"
    ;;
  fusion)
    CONFIG="fusion.project.config.json"
    APPID="wxecbcf00ce480fcf2"
    ;;
  "")
    echo "Usage: $0 <channel>"
    echo ""
    echo "Available channels:"
    echo "  nano    (root/fallback)  →  appid: wx84bd7d00a6fd626e"
    echo "  aeviva                   →  appid: wxd19a1403c4fea89d"
    echo "  fusion                   →  appid: wxecbcf00ce480fcf2"
    exit 1
    ;;
  *)
    echo "Unknown channel: $CHANNEL"
    echo "Available: nano, aeviva, fusion"
    exit 1
    ;;
esac

SRC="$MINIAPP_DIR/$CONFIG"
DST="$MINIAPP_DIR/project.config.json"

if [[ ! -f "$SRC" ]]; then
  echo "Config file not found: $SRC"
  exit 1
fi

cp "$SRC" "$DST"
echo "Switched miniapp to channel: $CHANNEL"
echo "  appid : $APPID"
echo "  config: $CONFIG → project.config.json"
