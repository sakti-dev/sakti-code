# Integration Suite Inventory

This document inventories all integration test suites in `packages/core/tests/integration/`, their ownership, dependencies, setup requirements, and status.

| File Path                                     | Owner Domain        | Dependency Class          | Setup Requirements                                            | Status                           |
| --------------------------------------------- | ------------------- | ------------------------- | ------------------------------------------------------------- | -------------------------------- |
| `integration/e2e-agent.test.ts`               | agent, tools        | External API, file system | `ZAI_API_KEY`, `RUN_ONLINE_TESTS=1`, temporary workspace dirs | Active - Requires online API key |
| `integration/search-docs-integration.test.ts` | tools (search-docs) | External API              | `ZAI_API_KEY`, `RUN_ONLINE_TESTS=1`                           | Active - Requires online API key |

## Notes

- Both integration tests are **online tests** that require `ZAI_API_KEY` and `RUN_ONLINE_TESTS=1` to run
- When API key is missing, tests are automatically skipped (not failed)
- `e2e-agent.test.ts` tests end-to-end AI agent behavior with multiple tools
- `search-docs-integration.test.ts` tests code research functionality with external documentation
- Both tests use `@sakti-code/zai` and Vercel AI SDK
