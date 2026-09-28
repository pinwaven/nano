#!/usr/bin/env bash
# One-time setup for headless Chromium on a server with no display, no fonts and no sudo
# (the EC2 dev box). Everything lands under $PREFIX; nothing touches the system.
#
#   bash tools/web-review/setup.sh
#
# Why each step exists:
#   - Playwright's own `install --with-deps` needs sudo apt; instead the .deb files are fetched
#     with `apt-get download` (no root) and unpacked with `dpkg-deb -x`.
#   - The box has no /etc/fonts and no font files, so every page renders blank. Noto CJK covers
#     Chinese, DejaVu/Liberation cover Latin, Noto Color Emoji covers emoji.
#   - libgallium (a Mesa driver) stays unresolved on purpose: only the optional GPU backend
#     dlopens it, and headless Chromium falls back to software rendering.
set -euo pipefail

PREFIX="${WEB_REVIEW_LIBS:-$HOME/.local/chromium-libs}"
HERE="$(cd "$(dirname "$0")" && pwd)"

LIB_PKGS=(libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libxcomposite1 libxdamage1
  libxfixes3 libxrandr2 libxrender1 libxi6 libxres1 libgbm1 libasound2t64 libfontconfig1
  fontconfig-config)
FONT_PKGS=(fonts-noto-cjk fonts-dejavu-core fonts-liberation fonts-noto-color-emoji)

cd "$HERE"
npm install --no-fund --no-audit
npx playwright install chromium

mkdir -p "$PREFIX/debs" "$PREFIX/root"
(cd "$PREFIX/debs" && apt-get download "${LIB_PKGS[@]}" "${FONT_PKGS[@]}")
for d in "$PREFIX"/debs/*.deb; do dpkg-deb -x "$d" "$PREFIX/root"; done

cat > "$PREFIX/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$PREFIX/root/usr/share/fonts</dir>
  <cachedir>$PREFIX/fontcache</cachedir>
  <alias><family>sans-serif</family><prefer><family>DejaVu Sans</family><family>Noto Sans CJK SC</family><family>Noto Color Emoji</family></prefer></alias>
  <alias><family>serif</family><prefer><family>DejaVu Serif</family><family>Noto Serif CJK SC</family></prefer></alias>
  <alias><family>monospace</family><prefer><family>DejaVu Sans Mono</family><family>Noto Sans Mono CJK SC</family></prefer></alias>
  <alias><family>system-ui</family><prefer><family>DejaVu Sans</family><family>Noto Sans CJK SC</family></prefer></alias>
  <alias><family>-apple-system</family><prefer><family>DejaVu Sans</family><family>Noto Sans CJK SC</family></prefer></alias>
  <alias><family>PingFang SC</family><prefer><family>Noto Sans CJK SC</family></prefer></alias>
  <alias><family>Microsoft YaHei</family><prefer><family>Noto Sans CJK SC</family></prefer></alias>
</fontconfig>
EOF

node "$HERE/review.js" --selftest
