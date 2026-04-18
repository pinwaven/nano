#!/bin/bash
set -e

# 1. Build the Coach Simulator
echo "Building Coach Simulator..."
cd tests/coach-simulator
npx vite build

# 2. Deploy the Admin Panel function
echo "Deploying Admin Panel..."
cd ../..
s admin-panel deploy  -y

echo "Done! Coach Simulator has been built and deployed."
