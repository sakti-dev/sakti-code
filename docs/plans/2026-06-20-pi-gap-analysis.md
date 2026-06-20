# Pi Gap Analysis — 2026-06-20

Comprehensive comparison of our implementation against `openspec/references/pi/`.
5 parallel agents analyzed: agent-loop, compaction, types/messages, tools, server/session.

---

## P0 — Correctness Bugs / Broken Features

### P0-1. No system prompt is ever sent to the LLM
- **Pi**: Builds a rich system prompt per turn (tool list, guidelines, project context, skills, cwd, date) via `buildSystemPrompt()` (`system-prompt.ts:28-173`) and threads it as `context.systemPrompt` (`agent-loop.ts:291-296`).
- **Ours**: `streamLLMResponse` calls `streamSimple(model, { messages, tools })` with no system prompt (`streaming.ts:202-221`). `AgentConfig` has no `systemPrompt` field. Zero references in `apps/server/src/`.
- **Impact**: Agent has no operating instructions, tool guidelines, or project context. Fundamental capability gap.
- **Files**: `packages/agent/src/loop/streaming.ts`, `packages/agent/src/types.ts`, `apps/server/src/agent/runner.ts`

### P0-2. Retry logic is dead — maxRetries never forwarded, in-stream errors not retried
- **Pi**: Delegates retry to `streamSimple` via `maxRetries`/`maxRetryDelayMs`/`timeoutMs` options (`agent-harness.ts:385-405`).
- **Ours**: We have our own retry loop (`streaming.ts:236-245`) but (a) never forward `maxRetries` to `streamSimple`, (b) per pi-ai contract, retryable errors come as stream `error` events not thrown exceptions — our `consumeStream` returns `{status:"error"}` immediately with no retry.
- **Impact**: The `maxRetries` config is silently non-functional. The `retry` event is never emitted against real providers.
- **Files**: `packages/agent/src/loop/streaming.ts`

### P0-3. `ThinkingContent` drops `thinkingSignature` and `redacted`
- **Pi**: `{ type:"thinking"; thinking:string; thinkingSignature?:string; redacted?:boolean }` (`ai/types.ts:259-267`).
- **Ours**: `{ thinking:string; type:"thinking" }` — both fields absent (`types.ts:12-15`).
- **Impact**: Multi-turn thinking continuity broken for Anthropic/OpenAI-Responses. Providers require `thinkingSignature` echo-back; without it, reasoning is dropped/rejected on subsequent turns.
- **Files**: `packages/agent/src/types.ts`

### P0-4. Tool result type is `string`, not `(TextContent|ImageContent)[]`
- **Pi**: `AgentToolResult { content: (TextContent|ImageContent)[]; details:T; terminate?:boolean }` — tools throw on failure, `isError` lives on the message.
- **Ours**: `AgentToolResult { content:string; isError?:boolean; terminate:boolean }` — no images, no structured details, inverted error model.
- **Impact**: No multimodal tool output (screenshots, diffs). No `details` channel for UI/logs. Blocks `afterToolCall` hook porting.
- **Files**: `packages/agent/src/types.ts`, `packages/tools/src/lib/types.ts`

### P0-5. Read tool: UTF-8 corruption + limit/offset bugs + image as data-URL
- **Pi**: Byte-accurate truncation (`truncate.ts:126-137`), honors `limit` before truncating (`read.ts:291-321`), structured image parts (`read.ts:247-274`).
- **Ours**: `content.slice(0, maxBytes)` corrupts multi-byte chars (`read.ts:140`); `limit:5` on a 3000-line file returns 2000 lines (`read.ts:134-135`); large `offset` with no `limit` returns empty silently (`read.ts:128`); images as `data:` URL strings (`read.ts:113-119`).
- **Impact**: Garbled non-ASCII files; wrong data returned; vision models can't consume images.
- **Files**: `packages/tools/src/tools/read.ts`

### P0-6. Grep `--max-count` is per-file, not total
- **Pi**: Counts matches globally, kills rg at limit (`grep.ts:287-290`).
- **Ours**: `rg --max-count ${maxMatches}` — rg semantics = N per file. `limit:100` across 50 files returns up to 5000 lines.
- **Impact**: Context window blowup on multi-file searches.
- **Files**: `packages/tools/src/tools/grep.ts`

### P0-7. Edit: no legacy `oldText`/`newText` support
- **Pi**: `prepareArguments` converts `oldText`/`newText` → `edits[]` and parses JSON-string `edits` (`edit.ts:307`).
- **Ours**: Only accepts `{path, edits}` — models sending `{path, oldText, newText}` or `edits: "[{...}]"` fail outright.
- **Impact**: Whole classes of edit calls fail depending on model habits.
- **Files**: `packages/tools/src/tools/edit.ts`

---

## P1 — Behavioral Drift / Capability Gaps

### Streaming Fidelity
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-1 | `message_update` drops evolving message snapshot | Carries full partial + raw provider event (`agent-loop.ts:322-340`) | Only `{update}` delta fragment (`types.ts:151-154`) |
| P1-2 | `text_start`/`text_end`/`thinking_start`/`thinking_end` silently dropped | All handled | Only `*_delta` handled (`streaming.ts:115-176`) |
| P1-3 | Tool progress batched, not live | `onUpdate` streams during execution (`agent-loop.ts:628-668`) | Accumulates, emits one post-completion event (`tool-execution.ts:37-46`) |
| P1-4 | `agent_end` doesn't carry messages | `{messages: AgentMessage[]}` (`types.ts:411`) | `{sessionId}` only (`types.ts:121-124`) |

### Turn Loop Structure
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-5 | `turn_start` emitted after prompt/steer | Before prompt (`agent-loop.ts:109-114`) | After prompt+steers (`loop/index.ts:141`) |
| P1-6 | `followUp` one-at-a-time drops remaining | Keeps rest queued (`agent.ts:134-147`) | Sets `followUpDone=true`, drops rest (`loop/index.ts:219`) |
| P1-7 | `followUp` checked after tool execution | Only on no-tool-call turn exit (`agent-loop.ts:257`) | Mid-loop after tools (`loop/index.ts:259-268`) |
| P1-8 | `steer()` aborts running tools | Only enqueues, tools always finish (`agent.ts:264-266`) | Enqueues + aborts (`loop/index.ts:229-230`) |
| P1-9 | Default queue modes differ | Both default to `"one-at-a-time"` (`agent.ts:212-213`) | Both default to `"all"` (`runner.ts:58-65`) |

### Missing Hooks & Extension Points
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-10 | No `beforeToolCall`/`afterToolCall` | Block/allow, override results (`types.ts:262-276`) | Absent entirely |
| P1-11 | No `prepareNextTurn`/`shouldStopAfterTurn`/`transformContext` | Mid-run model/context swap (`types.ts:186-218`) | Absent |
| P1-12 | No `validateToolArguments` | Schema validation before execute (`agent-loop.ts:580`) | Args passed raw (`tool-execution.ts:26-88`) |
| P1-13 | No `getApiKey` callback | Per-call resolution for OAuth tokens (`types.ts:194-196`) | Static key, resolved once |

### Types & Messages
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-14 | `ToolResultMessage.role` is `"tool"` not `"toolResult"` | `"toolResult"` (`ai/types.ts:323`) | `"tool"` (`types.ts:40-47`) |
| P1-15 | `UserMessage.content` is string-only | `string \| (TextContent\|ImageContent)[]` | `string` — no multimodal input |
| P1-16 | `AssistantMessage` attribution untyped | `api:Api`, `provider:Provider`, `stopReason:StopReason` union | All `string?`, faked with sentinels (`streaming.ts:28-30`) |
| P1-17 | Closed `AgentMessage` union, no `convertToLlm` | Open via declaration merging (`types.ts:135-186`) | 3-arm closed union |
| P1-18 | No custom message types | Compaction/branch/bash/custom (`messages.ts:29-77`) | None |
| P1-19 | Steering/followUp are string queues | Callbacks returning `AgentMessage[]` (`types.ts:219-243`) | `string` queues, silently dropped on overflow |
| P1-20 | `TextContent` drops `textSignature` | `{ text:string; type:"text"; textSignature?:string }` (`ai/types.ts:253-257`) | No `textSignature` (`types.ts:7-10`) |
| P1-21 | `SessionStore` is flat log, not typed entry tree | 11 entry kinds, `appendCompaction`/`buildContext`/fork (`harness/session/session.ts`) | `appendMessage`/`loadMessages`/`replaceMessages` — compaction is destructive |

### Tool Implementation
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-22 | Edit: no fuzzy matching | NFKC + smart quote/dash normalization (`edit-diff.ts:33-54`) | Exact match only |
| P1-23 | Edit: missing safety checks | Rejects empty `oldText`, detects no-op/overlap (`edit-diff.ts:315-363`) | None — empty oldText causes confusing error, overlapping edits silently wrong |
| P1-24 | Edit: lone `\r` not normalized | `normalizeToLF` handles `\r\n` and lone `\r` (`edit-diff.ts:18-20`) | Only `\r\n` handled (`edit.ts:18-20`) |
| P1-25 | Bash: keeps HEAD not TAIL of output | `truncateTail` keeps last N lines | `OutputAccumulator` keeps first N (`shell.ts:59-68`) |
| P1-26 | Bash: no process-tree kill | `killProcessTree(child.pid)` (`bash.ts:95-96`) | `child.kill("SIGKILL")` — orphans children |
| P1-27 | Bash: forced 30s timeout, can't disable | No default timeout | `defaultTimeout=30_000`, `timeout:0` still 30s |
| P1-28 | Bash: non-zero exit drops status line | Appends `Command exited with code N` (`bash.ts:393-407`) | Only `isError:true` with raw output |
| P1-29 | Grep: missing `glob`/`literal`/`context` params | All supported (`grep.ts:24-36`) | Only `pattern/path/ignoreCase/limit` |
| P1-30 | Grep: colon-parse breaks on `:` in filenames | `rg --json` structured output | `indexOf(":")` + slice (`grep.ts:61-64`) |
| P1-31 | Grep/find: synchronous `execSync` blocks event loop | `spawn` + streaming | `execSync` with 1MB maxBuffer (`shell.ts:36-44`) |
| P1-32 | Find: `/` in patterns not handled | `--full-path` when pattern has `/` (`find.ts:239-245`) | Bare `fd --glob` — path globs return nothing |
| P1-33 | No path normalization (`~`, unicode spaces, `@`) | `resolveToCwd` + `normalizePath` (`paths.ts:57-84`) | Bare `resolve(cwd, path)` |
| P1-34 | No abort signal in read/write/edit/grep/find/ls | All abort-aware | Signal dropped in most tools |
| P1-35 | Ls: no abort, no precheck, no empty/limit notices | Checks exists+isDir, `(empty directory)`, entry-limit notices | Lets errors throw, empty dir → empty string |

### Server / Session
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-36 | WS disconnect orphans active run | `dispose()` aborts everything | Never aborts, run stays registered forever (`ws.ts:114-125`) |
| P1-37 | Model resolver: no fallback/fuzzy/custom | 5-tier resolution + `buildFallbackModel` | Exact match or throw (`model-resolver.ts:13-34`) |
| P1-38 | No project-context/agents-files/skills injection | `ResourceLoader` discovers CLAUDE.md/AGENTS.md/skills | None |

### Compaction Quality
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-39 | No iterative summary update | `UPDATE_SUMMARIZATION_PROMPT` + `previousSummary` | Always re-summarizes from scratch |
| P1-40 | Summary message has wrong role + framing | `compactionSummary` role, XML-wrapped | Plain `user` message, pollutes next compaction |
| P1-41 | No file-operation tracking | Cumulative read/modified file lists in summary | Nothing |
| P1-42 | Summary template missing Constraints & Blocked sections | 6 sections including constraints/blockers | 5 sections, no constraints/blockers |
| P1-43 | Summarization system prompt weakened | "Do NOT respond to any questions" + "ONLY output the structured summary" | Only "Do NOT continue the conversation" |

### Retry / Error Recovery
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-44 | No in-stream error retry | Classifies + retries with backoff (`agent-session.ts:2484-2497`) | Stream errors end turn immediately |
| P1-45 | No context-overflow recovery | Compact + retry once on overflow | No overflow detection |

---

## P2 — Minor / Polish / Feature Gaps

### Agent Loop
- `sessionId` not forwarded to `streamSimple` (prompt-cache efficiency)
- `onPayload`/`onResponse`/`transport`/`thinkingBudgets`/`headers`/`metadata`/`timeoutMs`/`cacheRetention` not forwarded to `streamSimple`
- `estimateContextTokens` returns bare number, not structured `ContextUsageEstimate { tokens, usageTokens, trailingTokens, lastUsageIndex }`
- Retry backoff uncapped (`baseDelay * 2 ** attempt`, no `maxRetryDelayMs`)
- `response.result()` not used for final message — uses stale `start` partial or event field instead of accumulated result
- Partial assistant message not pushed to `messages` array during streaming (mid-stream crash loses it)

### Types & Events
- `tool_execution_start` missing `args`; `tool_execution_end` missing `isError`
- `message_start`/`message_end` payload optional (pi: required)
- Extra event types in core union (`error`/`compaction_*`/`retry`) that pi puts in harness layer
- `thinkingLevel`/`steeringMode`/`followUpMode` typed as `string` not unions
- No `SimpleStreamOptions` passthrough (temperature, maxTokens, transport, timeoutMs, headers, etc.)
- `AgentTool`: no `label`, untyped `parameters`, no `prepareArguments`, no per-tool `executionMode`
- No `AgentState`/`AgentContext` interfaces

### Tools
- Ls: sort order differs (dirs-first case-sensitive vs alphabetical case-insensitive)
- Grep/find: relativize against `cwd` not `searchPath`
- Bash: streaming polls on 50ms `setInterval`, no temp file for truncated output
- Bash: no working-directory existence check, no `commandPrefix`/`shellPath`/`spawnHook` hooks
- Edit: no diff/patch/firstChangedLine in result
- Edit: `existsSync` instead of `R_OK | W_OK` access check
- Write: no mutation queue (concurrent writes race); uses `join(filePath, "..")` for dirname; byte-length in success message instead of char-length
- Read: image MIME detected by extension first then magic bytes (two reads); no auto-resize for vision models
- Grep: no per-line truncation (50KB minified lines stream into context)
- Grep: no `ensureTool` auto-download for rg/fd; hardcoded timeouts (30s/15s)
- Grep: flag-injection test may fail (`pattern: "-i password"` not rejected as error)
- No `ensureTool` auto-download for rg/fd

### Compaction
- No split-turn (turn-prefix) summarization — when cut lands mid-turn, kept messages begin without context of originating request
- `maxTokens` not capped by `model.maxTokens` (can exceed provider output limit)
- `tokensBefore` uses char/4 estimate not `estimateContextTokens`
- No `thinkingLevel`/reasoning passed to summarization call
- No `customInstructions` parameter
- No `streamFn`/`headers`/`env` on summarization call (loses request-consistency and telemetry)
- `shouldCompact` uses `>=` vs pi's `>`
- `estimateTokens` undercounts tool-call tokens (omits tool name)

### Server
- Compaction route re-derives provider from `getForProject` (500s on global default)
- Compaction route uninterruptible (no `signal`), emits no events
- No `streamingBehavior` on prompt (no single-call "prompt-and-queue-as-followUp" path)
- No queue introspection / `queue_update` events
- No model-change/thinking-level-change/compaction session entries
- Settings are flat KV, no compaction/retry/timeout tuning
- Available-models catalog not auth-filtered
- Abort is fire-and-forget, no wait-for-idle
- Assistant message fidelity lost on DB round-trip (thinking blocks dropped, multi-text flattened)
- No per-tool prompt snippets or MCP/extension tools

### Missing Features (architectural)
- Skills system
- Session tree with forking/navigation
- MCP/extension tools
- Branch summarization
- Per-session long-lived loop object (we reconstruct per prompt)
- Harness hook system (`before_provider_request`, `save_point`, `settled`, etc.)
- Phase state machine (`idle`/`turn`/`compaction`/`branch_summary`)
- `nextTurn` queue (distinct from `followUp`)
- Mid-session model/thinking/tools changes persisted in session history

---

## Recommended Fix Priority

### Tier 1 — Foundation (blocks everything else)
1. **P0-1**: System prompt plumbing (config field → streaming → runner)
2. **P0-4**: Tool result type → structured blocks + `details` + throw-on-error
3. **P0-3**: `thinkingSignature`/`redacted` on ThinkingContent

### Tier 2 — Correctness (broken right now)
4. **P0-5**: Read tool (UTF-8, limit/offset, images)
5. **P0-6**: Grep max-count
6. **P0-7**: Edit legacy args
7. **P0-2**: Retry logic (forward maxRetries, handle in-stream errors)
8. **P1-36**: WS disconnect cleanup

### Tier 3 — High-impact UX
9. **P1-1/2/3/4**: Streaming fidelity (message_update snapshot, start/end events, live tool updates)
10. **P1-22/23/24**: Edit fuzzy match + safety checks + \r normalization
11. **P1-25/26/27/28**: Bash tail truncation, tree-kill, timeout, exit status
12. **P1-31**: Grep/find async (no event loop blocking)
13. **P1-39/40/41/42/43**: Compaction quality (iterative summary, role/framing, file tracking, template, prompt)

### Tier 4 — Type system alignment
14. **P1-14/15/16/17/18/20/21**: Message type alignment (role, multimodal, attribution, open union, textSignature, SessionStore)
15. **P1-10/11/12/13**: Hook system (beforeToolCall, validateToolArguments, prepareNextTurn, getApiKey)

### Tier 5 — Polish
16. P2 items as needed
