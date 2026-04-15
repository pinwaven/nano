#!/bin/bash
set -e

# 1. Build the Chat Simulator
echo "Building Chat Simulator..."
cd tests/chat-simulator
npx vite build

# 2. Deploy the Admin Panel function
echo "Deploying Admin Panel..."
cd ../..
s admin-panel deploy  -y

echo "Done! Chat Simulator has been built and deployed."
