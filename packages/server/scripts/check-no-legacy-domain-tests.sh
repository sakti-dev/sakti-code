#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if rg --files packages/server/tests/{bus,contracts,db,middleware,migration,plugin,provider,routes,spec,state} -g "*.test.ts" 2>/dev/null | grep -q .; then
  echo "Found forbidden legacy domain test files under packages/server/tests/*"
  exit 1
fi
