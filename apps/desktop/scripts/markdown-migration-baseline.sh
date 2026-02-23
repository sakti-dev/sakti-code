#!/usr/bin/env bash
set -euo pipefail

OUT=tests/fixtures/recorded/perf-reports/markdown-migration.baseline.log
mkdir -p "$(dirname "$OUT")"
: > "$OUT"

{
  date -u +"%Y-%m-%dT%H:%M:%SZ"
  echo "COMMAND: src/components/ui/__tests__/markdown.test.tsx"
  pnpm --filter @sakti-code/desktop exec vitest run src/components/ui/__tests__/markdown.test.tsx
  echo "COMMAND: src/components/ui/__tests__/markdown-streaming.test.tsx"
  pnpm --filter @sakti-code/desktop exec vitest run src/components/ui/__tests__/markdown-streaming.test.tsx
  echo "COMMAND: tests/integration/markdown-stream-stress.test.tsx"
  pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-stream-stress.test.tsx
} | tee "$OUT"
