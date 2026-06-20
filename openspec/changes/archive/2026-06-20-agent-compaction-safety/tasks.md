## 1. Cut-point orphan guard (Task 2 — pi findValidCutPoints)

- [x] 1.1 Write failing test in `packages/agent/src/__tests__/compaction-execution.test.ts`: build a conversation (`longConversation(40)` history + an assistant tool-call + its `tool` result + a trailing assistant text) with a tiny `keepRecentTokens` that forces the raw cut to land on the `tool` message. Assert `result.messages` (the kept window) does NOT start with a `tool` message, AND no `tool` message in the result lacks a preceding assistant tool-call. RED.
- [x] 1.2 Add the "no valid cut point" defensive test: a conversation where advancing past `tool` messages would exhaust the array → assert compaction returns `messages` unchanged (no summarization, no orphan). RED.
- [x] 1.3 Confirm both RED against current `compaction.ts`.
- [x] 1.4 In `packages/agent/src/compaction.ts`, after the walk-back loop sets `cutIndex`, add the advancement: `while (cutIndex < messages.length && messages[cutIndex]?.role === "tool") cutIndex++;`.
- [x] 1.4b **Widen the keep-all guard** from `if (cutIndex <= 1)` to `if (cutIndex <= 1 || cutIndex >= messages.length)` so exhaustion (advancement ran off the end) triggers keep-all, matching pi's `cutPoints.length === 0` → keep-all (compaction.ts:403). WITHOUT this, an exhausted `cutIndex` (e.g. 40) passes `<= 1` and yields `recentMessages = slice(40) = []` (summarize-all-keep-nothing). This guard change is mandatory, not optional.
- [x] 1.5 Tests → GREEN. Run `bun vitest run packages/agent/` — no regressions.
- [x] 1.6 Gate: `bun typecheck && bun x ultracite check`. Commit "fix(compaction): advance cut past tool results to avoid orphaning (pi findValidCutPoints)".

## 2. Serializer fidelity + tool-result truncation (Task 8 — pi serializeConversation)

- [x] 2.1 Write failing tests in `packages/agent/src/__tests__/compaction-execution.test.ts` (or `compaction.test.ts`):
  - (a) a `tool` message with 5000-char content → assert the summarization prompt text (captured via the `completeSimple` mock's first call args) is `<first 2000 chars>\n\n[... 3000 more characters truncated]` and total length < 5000. RED.
  - (b) an `assistant` message with thinking + text + toolCall blocks → assert the summarization text contains `[Assistant thinking]:`, `[Assistant]:`, and `[Assistant tool calls]:` sections. RED.
  - (c) an assistant text-only message → assert ONLY `[Assistant]:` appears (no empty sections). RED.
- [x] 2.2 Confirm RED (current `messageToText` emits `Assistant:`/`Tool (name):` with no truncation, drops thinking/toolcalls).
- [x] 2.3 In `packages/agent/src/compaction.ts`, add `const TOOL_RESULT_MAX_CHARS = 2000;` and `function truncateForSummary(text, maxChars)` matching pi `utils.ts:89-98` verbatim (marker `\n\n[... ${truncatedChars} more characters truncated]`).
- [x] 2.4 Rewrite `messageToText` to mirror pi `serializeConversation` (`utils.ts:109-163`) field-for-field:
  - `user` → `[User]: ${msg.content}` ONLY when `msg.content` is non-empty (pi `if (content)` guard).
  - `assistant` → collect `thinkingParts`/`textParts`/`toolCalls` arrays from content blocks; emit, in order and each gated on `.length > 0`: `[Assistant thinking]: ${thinkingParts.join("\n")}`, `[Assistant]: ${textParts.join("\n")}`, `[Assistant tool calls]: ${calls.join("; ")}`. Each call = `${block.name}(${argsStr})`, `argsStr = Object.entries(args).map(([k,v]) => \`${k}=${JSON.stringify(v)}\`).join(", ")`. **Join multiple present sections with `"\n\n"`** (pi's `parts.join("\n\n")`).
  - `tool` → `[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}` ONLY when content non-empty.
  Do NOT replicate pi's `convertToLlm` (no custom message types in our model — no-op equivalent).
- [x] 2.4b Add a test asserting a multi-section assistant message (thinking + text + toolcall) yields sections separated by `\n\n`, in the pi order, with tool-call args formatted as `name(k="v", n=1)`.
- [x] 2.5 Search the test suite for any assertion on the OLD serializer format (`Assistant:`, `Tool (`, `User:` without brackets) and update those tests to the bracket form. (Internal function — no external contract.)
- [x] 2.6 Tests → GREEN. Run `bun vitest run packages/agent/`.
- [x] 2.7 Gate + commit "feat(compaction): mirror pi serializeConversation (3-section + tool-result truncation)".

## 3. Verification

- [x] 3.1 `bun vitest run packages/agent/` — all pass (expect ~72 + new orphan + serializer tests; no regressions in existing compaction tests).
- [x] 3.2 `cd packages/db && bun test` — unchanged (no DB change); confirm no regressions.
- [x] 3.3 `bun vitest run apps/server/src/agent/__tests__/` — confirm the manual compaction route (`POST /api/sessions/:id/compact`) still works end-to-end (it calls `compactMessages`).
- [x] 3.4 `cd apps/server && bun test src/__tests__` — no regressions.
- [x] 3.5 `bun typecheck` — 0 errors.
- [x] 3.6 `bun x ultracite check` — 0 remaining diagnostics.
- [x] 3.7 Cross-check every scenario in `specs/agent-loop/spec.md` against the implemented tests; each scenario SHALL have a covering test. Specifically confirm the ship gate: construct an adversarial conversation where the raw cut lands on a `tool` message and assert `recentMessages` does not start with `tool`.
- [x] 3.8 Independence check: confirm this change did NOT modify `streaming.ts`, `types.ts`, or the "Agent loop supports compaction" trigger requirement — it must remain independent of `agent-stream-message-correctness` so the two archive in either order.
