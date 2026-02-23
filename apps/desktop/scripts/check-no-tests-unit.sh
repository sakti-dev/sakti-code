#!/usr/bin/env bash
set -euo pipefail

if [ -d apps/desktop/tests/unit ] && rg --files apps/desktop/tests/unit | grep -q .; then
  echo "Found forbidden files under apps/desktop/tests/unit"
  exit 1
fi
