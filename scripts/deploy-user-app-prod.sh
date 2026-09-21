#!/bin/bash
set -e

echo "Building User App..."
cd src/web/user-app
npx vite build

echo "Deploying user-app function (prod)..."
cd ../../..
scripts/s.sh user-app deploy -t s-prod.yaml -y

echo "Done! User App is live at https://nano.gcn.net/app/"
