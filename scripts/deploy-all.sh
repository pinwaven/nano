#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> [1/4] Building Chat Simulator..."
cd "$ROOT/tests/chat-simulator"
npx vite build

echo "==> [2/4] Building Coach Simulator..."
cd "$ROOT/tests/coach-simulator"
npx vite build

echo "==> [3/4] Building Admin Panel..."
cd "$ROOT/src/web/admin-panel"
npx vite build

echo "==> [4/4] Deploying Worker + Admin Panel..."
cd "$ROOT"
s worker deploy -y
s admin-panel deploy -y

echo ""
echo "Done! Worker, simulators, and admin panel deployed."
