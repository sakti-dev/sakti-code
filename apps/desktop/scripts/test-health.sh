#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
pnpm --filter @sakti-code/desktop test:run
pnpm exec tsc -p tests/tsconfig.json --noEmit
