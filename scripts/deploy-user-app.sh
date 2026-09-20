#!/bin/bash
set -e

echo "Building User App..."
cd src/web/user-app
npx vite build

echo "Deploying user-app function (dev)..."
cd ../../..
scripts/s.sh user-app deploy -y

echo "Done! User App is live at https://nano-dev.gcn.net/app/"
