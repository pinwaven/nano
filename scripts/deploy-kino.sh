#!/bin/bash
set -e

# 1. Build the Kino Simulator
echo "Building Kino Simulator..."
cd tests/kino-simulator
npx vite build

# 2. Deploy the Admin Panel function
echo "Deploying Admin Panel..."
cd ../..
s admin-panel deploy  -y

echo "Done! Kino Simulator has been built and deployed."
