# Codebase Concerns

**Analysis Date:** 2026-02-22

## Tech Debt

**Chokidar Watch Implementation:**

- Issue: Chokidar file watching is stubbed/not fully implemented
- Files: `apps/electron/src/ipc.ts` (lines 300-320)
- Impact: File change detection in Electron not functional
- Fix approach: Implement chokidar watch/stop handlers in Phase 5

**Memory Resource Scope:**

- Issue: Observational memory resource scope not fully implemented
- Files: `packages/core/src/memory/observation/orchestration.ts` (line 231)
- Impact: Memory system may not properly scope to resources
- Fix approach: Implement when resource scope is supported

## Known Bugs

**Timeout Handling in Stream Parser:**

- Symptoms: Pending read not interrupted by reader.cancel()
- Files: `apps/desktop/tests/unit/lib/chat/chat-stream-parser.test.ts` (line 198)
- Trigger: Long-running streams with timeout
- Workaround: None documented

## Security Considerations

**Environment Secrets:**

- Risk: .env file contains API keys
- Files: `.env`
- Current mitigation: .gitignored
- Recommendations: Use proper secret management in production

**Basic Auth:**

- Risk: Simple username/password auth with potential exposure
- Files: `packages/server/src/middleware/auth.ts`
- Current mitigation: Session tokens, rate limiting
- Recommendations: Consider OAuth/OIDC for production

## Performance Bottlenunks

**Message Store Lookup:**

- Problem: Full table scans possible on message queries
- Files: `packages/server/db/messages.ts`
- Cause: Missing indexes on common query patterns
- Improvement path: Add indexes on thread_id, created_at

**Event Deduplication:**

- Problem: Large event arrays require O(n) deduplication
- Files: `packages/shared/src/event-deduplication.ts`
- Cause: Array-based approach
- Improvement path: Use Map/Set for O(1) lookups

## Fragile Areas

**Event Bus:**

- Why fragile: Complex event ordering requirements
- Files: `packages/server/src/bus/`, `packages/shared/src/event-ordering.ts`
- Safe modification: Ensure backward compatibility with event types
- Test coverage: Good test coverage in `packages/server/tests/bus/`

**Markdown Parsing:**

- Why fragile: Complex streaming edge cases
- Files: `apps/desktop/src/components/ui/markdown.tsx`
- Safe modification: Test streaming scenarios
- Test coverage: Good coverage in desktop tests

## Scaling Limits

**SQLite:**

- Current capacity: Single user, small-medium projects
- Limit: Single-writer, limited concurrent connections
- Scaling path: Consider PostgreSQL for multi-user or large-scale deployments

**In-Memory Caching:**

- Current capacity: Single instance
- Limit: Memory-bound per process
- Scaling path: Distributed cache (Redis) for multi-instance

## Dependencies at Risk

**Zod 4.x:**

- Risk: Using pre-release version (^4.3.6)
- Impact: API changes may break builds
- Migration plan: Monitor for stable release, consider downgrading to 3.x

**Electron 39.x:**

- Risk: Recent major version
- Impact: API changes, security updates
- Migration plan: Keep updated with Electron releases

**Drizzle ORM 0.45.x:**

- Risk: Older version, potential bugs
- Impact: Schema migrations, query issues
- Migration plan: Upgrade to latest 0.46+ for bug fixes

## Missing Critical Features

**Provider Failover:**

- Problem: No automatic fallback when primary LLM provider fails
- Blocks: Production reliability

**Offline Mode:**

- Problem: No offline capability
- Blocks: Desktop app without network

## Test Coverage Gaps

**Server Route Coverage:**

- What's not tested: Some routes lack comprehensive tests
- Files: `packages/server/src/routes/` (e.g., diff.ts, mcp.ts, rules.ts)
- Risk: Breaking changes undetected
- Priority: Medium

**Core Tool Coverage:**

- What's not tested: Some filesystem tools
- Files: `packages/core/src/tools/filesystem/`
- Risk: Edge cases in file operations
- Priority: Medium

---

_Concerns audit: 2026-02-22_
