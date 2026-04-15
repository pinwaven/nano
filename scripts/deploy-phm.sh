#!/bin/bash
set -e

# 1. Build the PHM Simulator
echo "Building PHM Simulator..."
cd tests/phm-simulator
npx vite build

# 2. Deploy the Admin Panel function
echo "Deploying Admin Panel..."
cd ../..
s admin-panel deploy  -y

echo "Done! PHM Simulator has been built and deployed."
