#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> [1/5] Building Kino Simulator..."
cd "$ROOT/tests/kino-simulator"
npx vite build

echo "==> [2/5] Building Chat Simulator..."
cd "$ROOT/tests/chat-simulator"
npx vite build

echo "==> [3/5] Building PHM Simulator..."
cd "$ROOT/tests/phm-simulator"
npx vite build

echo "==> [4/5] Building Admin Panel..."
cd "$ROOT/src/web/admin-panel"
npx vite build

echo "==> [5/5] Deploying Worker + Admin Panel..."
cd "$ROOT"
s worker deploy -y
s admin-panel deploy -y

echo ""
echo "Done! Worker, simulators, and admin panel deployed."
