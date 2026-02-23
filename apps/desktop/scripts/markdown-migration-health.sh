#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @sakti-code/desktop exec vitest run src/components/ui/__tests__/markdown.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run src/components/ui/__tests__/markdown-streaming.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run src/views/workspace-view/chat-area/parts/__tests__/text-part.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run src/views/workspace-view/chat-area/parts/__tests__/reasoning-part.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-stream-stress.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-benchmark.report.test.tsx
pnpm --filter @sakti-code/desktop typecheck
pnpm --filter @sakti-code/desktop lint
