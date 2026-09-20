#!/usr/bin/env bash
# Portable wrapper around the Serverless Devs CLI for the deploy:* npm scripts.
#
# The scripts used to be `source .env && s <fn> deploy -y`, which breaks on Linux:
# npm runs scripts with /bin/sh (no `source` builtin) and `s` is a local
# devDependency, not on PATH. This loads .env into the environment (exported, so
# s.yaml's ${env(...)} lookups see it) and runs the repo's own `s` via npx.
#
# Usage: scripts/s.sh <s args...>   e.g.  scripts/s.sh worker deploy -y
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
exec npx s "$@"
