#!/bin/bash
set -e

# 1. Build the Admin Panel
echo "Building Admin Panel..."
cd src/web/admin-panel
npx vite build

# 2. Deploy the Admin Panel function
echo "Deploying Admin Panel..."
cd ../../..
s admin-panel deploy -y

echo "Done! Admin Panel has been built and deployed to https://nano.fros.cc/admin/"
