## 1. Cut-point orphan guard (Task 2 — pi findValidCutPoints)

- [ ] 1.1 Write failing test in `packages/agent/src/__tests__/compaction-execution.test.ts`: build a conversation (`longConversation(40)` history + an assistant tool-call + its `tool` result + a trailing assistant text) with a tiny `keepRecentTokens` that forces the raw cut to land on the `tool` message. Assert `result.messages` (the kept window) does NOT start with a `tool` message, AND no `tool` message in the result lacks a preceding assistant tool-call. RED.
- [ ] 1.2 Add the "no valid cut point" defensive test: a conversation where advancing past `tool` messages would exhaust the array → assert compaction returns `messages` unchanged (no summarization, no orphan). RED.
- [ ] 1.3 Confirm both RED against current `compaction.ts`.
- [ ] 1.4 In `packages/agent/src/compaction.ts`, after the walk-back loop sets `cutIndex`, add the advancement: `while (cutIndex < messages.length && messages[cutIndex]?.role === "tool") cutIndex++;`. (The existing `cutIndex <= 1` / keep-all guard handles the exhaustion case — verify it still triggers, or adjust to `cutIndex >= messages.length`.)
- [ ] 1.5 Tests → GREEN. Run `bun vitest run packages/agent/` — no regressions.
- [ ] 1.6 Gate: `bun typecheck && bun x ultracite check`. Commit "fix(compaction): advance cut past tool results to avoid orphaning (pi findValidCutPoints)".

## 2. Serializer fidelity + tool-result truncation (Task 8 — pi serializeConversation)

- [ ] 2.1 Write failing tests in `packages/agent/src/__tests__/compaction-execution.test.ts` (or `compaction.test.ts`):
  - (a) a `tool` message with 5000-char content → assert the summarization prompt text (captured via the `completeSimple` mock's first call args) is `<first 2000 chars>\n\n[... 3000 more characters truncated]` and total length < 5000. RED.
  - (b) an `assistant` message with thinking + text + toolCall blocks → assert the summarization text contains `[Assistant thinking]:`, `[Assistant]:`, and `[Assistant tool calls]:` sections. RED.
  - (c) an assistant text-only message → assert ONLY `[Assistant]:` appears (no empty sections). RED.
- [ ] 2.2 Confirm RED (current `messageToText` emits `Assistant:`/`Tool (name):` with no truncation, drops thinking/toolcalls).
- [ ] 2.3 In `packages/agent/src/compaction.ts`, add `const TOOL_RESULT_MAX_CHARS = 2000;` and `function truncateForSummary(text, maxChars)` matching pi `utils.ts:89-98` verbatim (marker `\n\n[... ${truncatedChars} more characters truncated]`).
- [ ] 2.4 Rewrite `messageToText` to mirror pi `serializeConversation` (`utils.ts:109-160`): `user` → `[User]: <content>`; `assistant` → emit present sections among `[Assistant thinking]:`, `[Assistant]:`, `[Assistant tool calls]: <name>(k=v, …); …` in that order; `tool` → `[Tool result]: <truncateForSummary(content, TOOL_RESULT_MAX_CHARS)>`. Keep the `AgentMessage` type's content-block shapes (text/thinking/toolCall).
- [ ] 2.5 Search the test suite for any assertion on the OLD serializer format (`Assistant:`, `Tool (`, `User:` without brackets) and update those tests to the bracket form. (Internal function — no external contract.)
- [ ] 2.6 Tests → GREEN. Run `bun vitest run packages/agent/`.
- [ ] 2.7 Gate + commit "feat(compaction): mirror pi serializeConversation (3-section + tool-result truncation)".

## 3. Verification

- [ ] 3.1 `bun vitest run packages/agent/` — all pass (expect ~72 + new orphan + serializer tests; no regressions in existing compaction tests).
- [ ] 3.2 `cd packages/db && bun test` — unchanged (no DB change); confirm no regressions.
- [ ] 3.3 `bun vitest run apps/server/src/agent/__tests__/` — confirm the manual compaction route (`POST /api/sessions/:id/compact`) still works end-to-end (it calls `compactMessages`).
- [ ] 3.4 `cd apps/server && bun test src/__tests__` — no regressions.
- [ ] 3.5 `bun typecheck` — 0 errors.
- [ ] 3.6 `bun x ultracite check` — 0 remaining diagnostics.
- [ ] 3.7 Cross-check every scenario in `specs/agent-loop/spec.md` against the implemented tests; each scenario SHALL have a covering test. Specifically confirm the ship gate: construct an adversarial conversation where the raw cut lands on a `tool` message and assert `recentMessages` does not start with `tool`.
- [ ] 3.8 Independence check: confirm this change did NOT modify `streaming.ts`, `types.ts`, or the "Agent loop supports compaction" trigger requirement — it must remain independent of `agent-stream-message-correctness` so the two archive in either order.
