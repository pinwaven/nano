#!/bin/bash
# Usage: ./resetTestChip.sh [--prod]
ENV_FLAG=""
if [ "$1" = "--prod" ]; then
  ENV_FLAG="--prod"
fi
node temp/reset-test-chip.js $ENV_FLAG MVNS0725122201-0087
node temp/reset-test-chip.js $ENV_FLAG MVNS0826022601-299
node temp/reset-test-chip.js $ENV_FLAG KNC88747157-0200