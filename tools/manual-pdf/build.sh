#!/bin/bash
# Regenerate docs/user-manual/end-user-guide.pdf from the markdown + screenshots.
set -e
cd "$(dirname "$0")"
python3 build.py
node print.js
python3 merge.py
rm -f guide.html _cover.pdf _body.pdf
rm -rf .cdp-profile
