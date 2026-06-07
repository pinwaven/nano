#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env not found at $ROOT_DIR/.env" >&2
  exit 1
fi

# Load DATABASE_URL_PROD from .env
DATABASE_URL_PROD=$(grep -E '^DATABASE_URL_PROD=' "$ENV_FILE" | head -1 | cut -d'=' -f2-)

if [[ -z "$DATABASE_URL_PROD" ]]; then
  echo "ERROR: DATABASE_URL_PROD not set in .env" >&2
  exit 1
fi

BACKUP_DIR="$ROOT_DIR/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/nano_db_prod_${TIMESTAMP}.dump"

echo "Backing up prod DB to: $BACKUP_FILE"

pg_dump \
  --format=custom \
  --compress=9 \
  --no-password \
  "$DATABASE_URL_PROD" \
  --file="$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "Done. Backup size: $SIZE"
echo "File: $BACKUP_FILE"
