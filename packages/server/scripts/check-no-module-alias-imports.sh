#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

if rg -n "from ['\"]@/modules/|await import\\(['\"]@/modules/" packages/server/src --glob '*.{ts,tsx}' 2>/dev/null | grep -q .; then
  echo "Found forbidden @/modules/* imports in packages/server/src. Use relative imports within modules."
  exit 1
fi
