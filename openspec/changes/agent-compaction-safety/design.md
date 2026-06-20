## Context

Two verified correctness defects in `compactMessages()` (`packages/agent/src/compaction.ts`), each line-verified against pi's compaction source. Full evidence in `docs/plans/2026-06-20-agent-runtime-pi-alignment.md` (Tasks 2 and 8). Both live in one file; the change ships one concrete guarantee: **compaction never returns an orphaned tool result**.

**pi's cut-point logic (the T2 reference)** lives in `findValidCutPoints` (`openspec/references/pi/packages/coding-agent/src/core/compaction/compaction.ts:300-318`). It is a **two-pass** design:
1. Precompute the set of valid cut indices — for every entry, push the index for `user`/`assistant`/`bashExecution`/`custom`/`branchSummary`/`compactionSummary` roles, and **skip** `toolResult` ("they must follow their tool call"). Non-message entries (thinking_level_change, model_change, compaction, label, …) are also skipped.
2. Walk back from the newest message accumulating estimated tokens; when the budget is exceeded at index `i`, pick "the closest valid cut point at or after `i`" (`compaction.ts:~407-413`): iterate the precomputed `cutPoints` array forward and take the first one `>= i`.

So pi's invariant is structural: a cut index is **never** a `toolResult`, by construction.

**pi's serializer (the T8 reference)** is `serializeConversation` (`openspec/references/pi/packages/coding-agent/src/core/compaction/utils.ts:109-160`), NOT in `compaction.ts` (the plan's T8 only mentioned truncation; the full pi serializer is richer). Per message:
- `user` → `[User]: <content>` (handles string or text-block content).
- `assistant` → up to **three** sections in order: `[Assistant thinking]: <thinking blocks>`, `[Assistant]: <text blocks>`, `[Assistant tool calls]: <name>(k=v, k=v); …`.
- `toolResult` → `[Tool result]: <truncateForSummary(content, 2000)>`.

`truncateForSummary` (`utils.ts:89-98`): if `text.length > maxChars`, return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`. `TOOL_RESULT_MAX_CHARS = 2000`.

**Our current state (the divergences):**
- `compaction.ts` cut-point loop — walks back, sets `cutIndex = i` on any role (including `tool`). Then `recentMessages = messages.slice(cutIndex)` can start with an orphaned tool result. The downstream provider rejects tool results with no preceding tool_use.
- `messageToText` — emits a single `Assistant: <text>` line (drops thinking + toolcall blocks), `Tool (<name>): <full content>` (no truncation), `User: <content>` (no brackets). A 50k-char tool result is serialized verbatim into the summarization prompt.

The change is confined to `packages/agent/src/compaction.ts` and its tests. It mirrors pi's invariants and serializer rather than inventing our own.

## Goals / Non-Goals

**Goals:**
- Guarantee `recentMessages` never starts with a `tool` message — the ship gate. Structural, like pi's `findValidCutPoints`.
- Mirror pi's `serializeConversation` so the summarizer sees thinking + toolcall context (not just assistant text) and tool results are bounded at 2000 chars.
- Keep the change independent of `agent-stream-message-correctness` so the two can ship/archive in either order.

**Non-Goals:**
- **Split-turn cuts** (pi's `isSplitTurn` / `turnPrefixMessages`, plan Task 12). pi can cut mid-turn (assistant + its tool results split across the summarize/keep boundary) and carries a turn-prefix into the next summarization. That's a distinct, larger feature — deferred to its own change; out of scope here. Our simpler model summarizes whole messages only.
- **Previous-summary chaining** (plan Task 13), **cumulative file-ops tracking** (plan Task 14). Deferred per the alignment plan; not needed for the orphan guarantee.
- **Changing the compaction trigger** (`estimateContextTokens` / `shouldCompact`). That's `agent-stream-message-correctness`'s concern (the `stopReason` skip). This change only touches `compactMessages()` internals and its serializer.
- **Persisting `thinking` blocks through the DB.** Discovered during Change 1's comparison (`agentMessageToRow` drops non-text assistant content). Documented there as the trigger for a follow-up `agent-message-persistence-fidelity` change. Note: the serializer here reads thinking blocks from the **in-memory** message array; until the DB round-trips them, a post-reload compaction won't see thinking — but that's the persistence bug's scope, not this change's. This change is correct against the in-memory message array the loop actually compacts.

## Decisions

### 1. Cut-point guard: snap forward past `tool` messages (behaviorally equivalent to pi's two-pass, minimal to our structure)

**Decision:** Keep our existing walk-back loop (accumulate tokens, break on budget → raw `cutIndex`). Then add one advancement step: `while (cutIndex < messages.length && messages[cutIndex]?.role === "tool") cutIndex++;`. **Crucially, the existing keep-all guard `if (cutIndex <= 1)` MUST be widened to `if (cutIndex <= 1 || cutIndex >= messages.length)`** so that exhaustion (advancement ran off the end because the entire keep-window was tool messages — a malformed conversation) triggers keep-all, matching pi's `if (cutPoints.length === 0) return { firstKeptEntryIndex: startIndex, ... }` (compaction.ts:403) which keeps everything when no valid cut point exists. Without this guard change, an exhausted cutIndex (= `messages.length`, e.g. 40) would pass `<= 1`, skip the keep-all, and produce `recentMessages = slice(40) = []` — i.e. summarize-all-keep-nothing, the opposite of the claimed behavior. This is the one place the v1 spec hand-waved a correctness property; the guard change is mandatory, not optional.

**Rationale:** pi precomputes the valid-cut-point set, then picks "closest valid cut point at or after `i`". For our simpler message model the only invalid cut role is `tool`, so "advance `cutIndex` forward past `tool` messages" produces the **same** selected index pi would pick. It's less code, fits our existing loop structure, and the equivalence is provable: the snap-forward finds exactly the smallest `j >= cutIndex` with `role !== "tool"`, which is pi's "closest valid cut point at or after `i`" (since our valid set is `role ∈ {user, assistant}`). Verified against pi's selection semantics.

**Alternatives considered:**
- *Mirror pi's two-pass verbatim (precompute `validCutPoints[]`, then select).* **Rejected:** identical outcome, more code, no fidelity gain for a 3-role model. The equivalence is documented; structural faithfulness where it matters (the invariant), mechanical faithfulness only where it changes behavior.
- *Pre-validate the whole conversation is well-formed (every `tool` has a preceding assistant tool-call).* **Rejected:** that's a data-integrity concern, not compaction's job. The guard ensures compaction doesn't *create* orphans; it doesn't need to prove the input was never orphaned.

### 2. Serializer: mirror pi's `serializeConversation` three-section form + truncation, not just "add truncation"

**Decision:** Rewrite `messageToText` to match pi's `serializeConversation` (`utils.ts:109-163`) section-for-section, including the details pi's code actually encodes:
- `user` → `[User]: <content>` — but **only if content is non-empty** (pi: `if (content) parts.push(...)`). Our `UserMessage.content` is always a `string`, so this is `if (msg.content) return \`[User]: ${msg.content}\``; empty user messages produce no line.
- `assistant` → emit whichever of `[Assistant thinking]: <thinkingParts.join("\n")>`, `[Assistant]: <textParts.join("\n")>`, `[Assistant tool calls]: <calls.join("; ")>` are present, **in that order**, each gated on `.length > 0`. Each `toolCall` serializes as `${block.name}(${argsStr})` where `argsStr = Object.entries(args).map(([k,v]) => \`${k}=${JSON.stringify(v)}\`).join(", ")` — pi's exact arg format. **The multiple sections within one assistant message SHALL be joined with `"\n\n"`** (pi joins ALL parts — across messages AND within a multi-section message — with `parts.join("\n\n")`, utils.ts:163; our external `historyMessages.map(messageToText).join("\n\n")` already joins between messages, so the within-message multi-section join must also be `"\n\n"` to match).
- `tool` → `[Tool result]: <truncateForSummary(content, TOOL_RESULT_MAX_CHARS)>` — but **only if content is non-empty** (pi: `if (content) parts.push(...)`, utils.ts:158).

Add `TOOL_RESULT_MAX_CHARS = 2000` and `truncateForSummary` (`utils.ts:89-98`) verbatim (same constant, same marker `\n\n[... ${truncatedChars} more characters truncated]`).

**Note on `convertToLlm`:** pi calls `convertToLlm(currentMessages)` before `serializeConversation` (compaction.ts:586-587) to map custom message types (bashExecution, custom, branchSummary, compactionSummary) onto LLM roles. Our message model has only `user`/`assistant`/`tool` — no custom types — so `convertToLlm` is a no-op equivalent for us and is intentionally NOT replicated. Stated explicitly rather than silently omitted.

**Rationale:** The plan's T8 only mentioned truncation, but pi's serializer is richer — it preserves thinking and toolcall context that our current `Assistant:` line drops. "Follow pi closely" means mirroring the serializer, not bolting truncation onto our lossy version. The three-section form gives the summarizer strictly more signal (reasoning + tool invocations) at no correctness cost. Truncation bounds token cost. All three behaviors are in one function, so doing them together is the natural unit.

**Alternatives considered:**
- *Only add truncation (plan's narrow T8).* **Rejected:** leaves the thinking/toolcall-drop bug in place; half-faithful. The fidelity gap is in the same function.
- *Import pi's `serializeConversation` directly.* **Rejected:** it lives in `coding-agent` (not `pi-ai`), depends on pi's `Message`/`SessionEntry` types and `convertToLlm`, and would pull a transitive type graph into `packages/agent`. Mirroring the logic against our `AgentMessage` type is the clean boundary; the function is small.

### 3. Use ADDED requirements (not MODIFY) to stay independent of `agent-stream-message-correctness`

**Decision:** Express both fixes as **ADDED** requirements under `agent-loop` ("Compaction cut-point never orphans a tool result"; "Compaction serialization mirrors pi"), rather than MODIFYing the existing "Agent loop supports compaction" requirement.

**Rationale:** `agent-stream-message-correctness` (Change 1) also MODIFIES that same requirement (to add the `stopReason` usage-skip). OpenSpec applies a MODIFIED requirement as a full replacement of the existing block — so two pending changes both MODIFYing the same requirement create a last-to-archive-wins hazard: whichever archives second would overwrite the other's edit unless its delta text already incorporates the first's. Using ADDED for this change's (orthogonal) concerns avoids the hazard entirely: Change 1 MODIFIES the trigger/estimate behavior, Change 2 ADDS cut-point + serialization requirements. The two deltas don't touch the same block, so archive order is free. The concerns are genuinely new normative constraints (the current spec says nothing about cut-point validity or serialization format), so ADDED is also semantically correct.

**Alternatives considered:**
- *MODIFY the existing requirement and incorporate Change 1's skip text.* **Rejected:** creates an artificial cross-change text dependency, forces a specific archive order, and risks the skip being dropped if someone re-derives the delta against the wrong baseline. ADDED is cleaner and order-free.

## Risks / Trade-offs

- **[Cut guard keeps more messages → compaction summarizes less]** → **Accepted / correct:** the guard can only grow `recentMessages` (advance forward = keep more). It never summarizes more than before, so it can't orphan previously-kept data. If the only cut point past budget is invalid, compaction is skipped for that turn — which is correct (no safe compaction possible); the next turn re-evaluates. Slightly less aggressive compaction in edge cases is the right trade for never sending an orphaned tool result.
- **[Serializer label change (`User:` → `[User]:`) may break a test asserting the old format]** → **Mitigation:** search the test suite for `messageToText` output assertions and update them; the function is internal (only `compactMessages` calls it), so no external contract breaks. Covered by the new serializer tests asserting the pi format.
- **[Thinking blocks not yet persisted by the DB]** → **Accepted / out of scope:** the serializer correctly reads thinking blocks from the in-memory array the loop compacts. A post-reload compaction won't see thinking until the DB round-trips them (the separate `agent-message-persistence-fidelity` follow-up). This change is correct against the array it's handed; the persistence gap is a different change's scope and is already documented as a trigger.
- **[Truncation loses tool-result tail]** → **Accepted:** the summarizer needs the gist, not verbatim output; pi makes the same trade with the same 2000-char bound. Full content remains in the persisted `tool` message — truncation only affects the summarization prompt text, not stored data.

## Migration Plan

No migration. Both changes are internal to `compactMessages()` and `messageToText`; no schema, route, event, or persisted-shape change. Existing compaction tests that assert `recentMessages` content may need the new "no orphan" cases added, and any test asserting the old `Assistant:`/`Tool (…):` serializer format must be updated to the bracket form. Rollback is reverting the commits.

## Open Questions

- Should the truncation marker match pi **exactly** (`[... N more characters truncated]`) or use our own wording? **Decision: match pi exactly** — the marker is internal to the summarization prompt and fidelity is free; a future "improve summarization" change can A/B it.
- Should we expose `TOOL_RESULT_MAX_CHARS` as a config knob? **Decision: no** — pi hardcodes 2000 and has no knob; YAGNI until a real need appears.
- Does the cut guard need to also skip a `tool` message at the **end** of the summarize window (leaving a trailing tool result with no following assistant)? **Decision: no** — a trailing tool result in the summarized history is fine (it had its preceding tool call, which is also being summarized); the orphan problem is specifically a `tool` at the **start** of `recentMessages` (kept window) with no preceding context. The guard addresses exactly that.
