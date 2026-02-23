#!/usr/bin/env bash
set -euo pipefail

OUT=tests/fixtures/recorded/perf-reports/markdown-migration.baseline.log
mkdir -p "$(dirname "$OUT")"
: > "$OUT"

{
  date -u +"%Y-%m-%dT%H:%M:%SZ"
  echo "COMMAND: tests/unit/components/markdown.test.tsx"
  pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx
  echo "COMMAND: tests/unit/components/markdown-streaming.test.tsx"
  pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-streaming.test.tsx
  echo "COMMAND: tests/integration/markdown-stream-stress.test.tsx"
  pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-stream-stress.test.tsx
} | tee "$OUT"
