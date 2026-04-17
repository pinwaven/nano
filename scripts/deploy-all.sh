#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> [1/4] Building Kino Simulator..."
cd "$ROOT/tests/kino-simulator"
npx vite build

echo "==> [2/4] Building Chat Simulator..."
cd "$ROOT/tests/chat-simulator"
npx vite build

echo "==> [3/4] Building PHM Simulator..."
cd "$ROOT/tests/phm-simulator"
npx vite build

echo "==> [4/4] Building Admin Panel..."
cd "$ROOT/src/web/admin-panel"
npx vite build

echo "==> Deploying Admin Panel..."
cd "$ROOT"
s admin-panel deploy -y

echo ""
echo "Done! All simulators and admin panel deployed."
