#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/components/markdown-streaming.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/views/workspace-view/chat-area/parts/text-part.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/unit/views/workspace-view/chat-area/parts/reasoning-part.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-stream-stress.test.tsx
pnpm --filter @sakti-code/desktop exec vitest run tests/integration/markdown-benchmark.report.test.tsx
pnpm --filter @sakti-code/desktop typecheck
pnpm --filter @sakti-code/desktop lint
