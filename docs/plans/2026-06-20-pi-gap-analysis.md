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

### P0-8. Double `agent_end` emitted on stream error
- **Pi**: Only emits `agent_end` from the loop, never from `streamAssistantResponse`.
- **Ours**: `streaming.ts:224` emits `agent_end` on stream error. Then `loop/index.ts:171` also emits `agent_end` after the stream function returns. Two `agent_end` events per error.
- **Impact**: Consumers receive duplicate `agent_end`, causing double-cleanup / UI glitches.
- **Files**: `packages/agent/src/loop/streaming.ts`, `packages/agent/src/loop/index.ts`

### P0-9. Edit sequential application corrupts multi-edit results
- **Pi**: Matches all edits against original content, then applies replacements in reverse index order so offsets remain stable.
- **Ours**: Applies `String.replace()` in a loop (`edit.ts:133-135`). If edit A's `newText` contains text matching edit B's `oldText`, edit B matches against the **modified** content.
- **Impact**: Silent data corruption when multiple edits interact. The gap analysis mentions overlap detection (P1-23) but not the application order bug.
- **Files**: `packages/tools/src/tools/edit.ts`

### P0-10. Write dirname uses `join(filePath, "..")` instead of `dirname()`
- **Pi**: Uses `dirname(absolutePath)`.
- **Ours**: Uses `join(filePath, "..")` — semantically wrong, fragile on trailing slashes and certain path edge cases.
- **Files**: `packages/tools/src/tools/write.ts`

### P0-11. Bash UTF-8 streaming corruption
- **Pi**: Uses `new TextDecoder({stream: true})` for proper incremental UTF-8 decoding across chunks.
- **Ours**: Accumulator treats each chunk independently — multi-byte chars split across chunks get corrupted.
- **Impact**: Garbled output from commands producing non-ASCII output (git logs, build output, etc.).
- **Files**: `packages/tools/src/lib/shell.ts`

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
| P1-6 | `followUp` one-at-a-time permanently disables followUp | Keeps rest queued (`agent.ts:134-147`) | Sets `followUpDone=true`, drops rest for entire run lifecycle (`loop/index.ts:219`) |
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
| P1-19 | Steering/followUp are string queues | Callbacks returning `AgentMessage[]` (`types.ts:219-243`) | `string` queues, silently dropped on overflow (`QUEUE_BOUND=10`) |
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
| P1-36 | Write: no mutation queue (concurrent writes race) | `withFileMutationQueue()` serialized by `realpath` | `withFileLock()` keyed by raw path string — symlinks not serialized |
| P1-37 | Edit: `existsSync` instead of `R_OK | W_OK` access check | `fsAccess(path, constants.R_OK \| constants.W_OK)` | `existsSync(filePath)` — doesn't check writability |
| P1-38 | Grep: `shellQuote` wrapping enables flag injection | `spawn` with args array — no shell interpolation | `execSync` with shell-escaped args — pattern passed through shell |

### Server / Session
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-39 | WS disconnect orphans active run | `dispose()` aborts everything | Never aborts, run stays registered forever (`ws.ts:114-125`) |
| P1-40 | Model resolver: no fallback/fuzzy/custom | 5-tier resolution + `buildFallbackModel` | Exact match or throw (`model-resolver.ts:13-34`) |
| P1-41 | No project-context/agents-files/skills injection | `ResourceLoader` discovers CLAUDE.md/AGENTS.md/skills | None |

### Compaction Quality
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-42 | No iterative summary update | `UPDATE_SUMMARIZATION_PROMPT` + `previousSummary` | Always re-summarizes from scratch |
| P1-43 | Summary message has wrong role + framing | `compactionSummary` role, XML-wrapped | Plain `user` message, pollutes next compaction |
| P1-44 | No file-operation tracking | Cumulative read/modified file lists in summary | Nothing |
| P1-45 | Summary template missing Constraints & Blocked sections | 6 sections including constraints/blockers | 5 sections, no constraints/blockers |
| P1-46 | Summarization system prompt weakened | "Do NOT respond to any questions" + "ONLY output the structured summary" | Only "Do NOT continue the conversation" |

### Retry / Error Recovery
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-47 | No in-stream error retry | Classifies + retries with backoff (`agent-session.ts:2484-2497`) | Stream errors end turn immediately |
| P1-48 | No context-overflow recovery | Compact + retry once on overflow | No overflow detection |

### Agent Resilience
| ID | Gap | Pi | Ours |
|----|-----|-----|------|
| P1-49 | `response.result()` never used for final message | Uses accumulated result, not `done` event's field | Trusts `event.message` directly — stale partial if stream impl differs |
| P1-50 | Partial message lost on mid-stream crash | Pushes partial to `context.messages` on `start` event | Doesn't touch messages array until stream completes — crash loses entire turn |
| P1-51 | No `continue()` / retry-from-context path | `agentLoopContinue()` retries from existing context | Must start fresh `prompt()` — loses accumulated context on error recovery |

---

## P2 — Minor / Polish / Feature Gaps

### Agent Loop
- `sessionId` not forwarded to `streamSimple` (prompt-cache efficiency)
- `onPayload`/`onResponse`/`transport`/`thinkingBudgets`/`headers`/`metadata`/`timeoutMs`/`cacheRetention` not forwarded to `streamSimple`
- `estimateContextTokens` returns bare number, not structured `ContextUsageEstimate { tokens, usageTokens, trailingTokens, lastUsageIndex }`
- Retry backoff uncapped (`baseDelay * 2 ** attempt`, no `maxRetryDelayMs`)
- Partial assistant message not pushed to `messages` array during streaming (mid-stream crash loses it) — see P1-50

### Types & Events
- `tool_execution_start` missing `args`; `tool_execution_end` missing `isError`
- `message_start`/`message_end` payload optional (pi: required)
- Extra event types in core union (`error`/`compaction_*`/`retry`) that pi puts in harness layer
- `thinkingLevel`/`steeringMode`/`followUpMode` typed as `string` not unions
- No `SimpleStreamOptions` passthrough (temperature, maxTokens, transport, timeoutMs, headers, etc.)
- `AgentTool`: no `label`, untyped `parameters`, no `prepareArguments`, no per-tool `executionMode`
- No `AgentState`/`AgentContext` interfaces
- Queue overflow silently drops messages (`QUEUE_BOUND=10`, no event or log)
- `Error` event in core types — pi encodes errors as assistant `stopReason:"error"` + `errorMessage` only

### Tools
- Ls: sort order differs (dirs-first case-sensitive vs alphabetical case-insensitive)
- Grep/find: relativize against `cwd` not `searchPath`
- Bash: streaming polls on 50ms `setInterval`, no temp file for truncated output
- Bash: no working-directory existence check, no `commandPrefix`/`shellPath`/`spawnHook` hooks
- Edit: no diff/patch/firstChangedLine in result
- Write: byte-length in success message instead of char-length
- Read: image MIME detected by extension first then magic bytes (two reads); no auto-resize for vision models
- Grep: no per-line truncation (50KB minified lines stream into context)
- Grep: no `ensureTool` auto-download for rg/fd; hardcoded timeouts (30s/15s)
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

## Implementation Checklist

### Phase 1 — Correctness bugs (P0)

**Goal: Fix everything that is actively broken or corrupting data.**

> - [ ] **P0-4** Tool result type → structured `(TextContent|ImageContent)[]` + `details` + throw-on-error
>   - `packages/agent/src/types.ts`, `packages/tools/src/lib/types.ts`
>   - Every tool's return value, every tool-result consumer
>   - **Do this first** — it's the keystone that unblocks hooks, multimodal, and structured results

> - [ ] **P0-1** System prompt plumbing
>   - Add `systemPrompt` to `AgentConfig` → thread through `streamLLMResponse` → build in runner
>   - `packages/agent/src/types.ts`, `packages/agent/src/loop/streaming.ts`, `apps/server/src/agent/runner.ts`

> - [ ] **P0-3** `thinkingSignature` / `redacted` on ThinkingContent
>   - `packages/agent/src/types.ts`

> - [ ] **P0-5** Read tool: byte-accurate truncation, honor `limit` before truncation, structured image output
>   - `packages/tools/src/tools/read.ts`

> - [ ] **P0-6** Grep max-count: switch to global count (spawn rg, count in JS, kill at limit)
>   - `packages/tools/src/tools/grep.ts`

> - [ ] **P0-7** Edit legacy args: `prepareArguments` converting `oldText`/`newText` → `edits[]`, parse JSON-string `edits`
>   - `packages/tools/src/tools/edit.ts`

> - [ ] **P0-8** Double `agent_end`: remove `agent_end` emit from `streaming.ts` error path
>   - `packages/agent/src/loop/streaming.ts`

> - [ ] **P0-9** Edit sequential application: match all edits against original, apply in reverse order
>   - `packages/tools/src/tools/edit.ts`

> - [ ] **P0-10** Write dirname: `join(filePath, "..")` → `dirname(filePath)`
>   - `packages/tools/src/tools/write.ts`

> - [ ] **P0-11** Bash UTF-8 streaming: use `TextDecoder({stream:true})` in output accumulator
>   - `packages/tools/src/lib/shell.ts`

### Phase 2 — Type system alignment (P1 types)

**Goal: Align types with pi-ai contract, unblocks hooks, multimodal, proper compaction.**

> - [ ] **P1-14** `ToolResultMessage.role` → `"toolResult"`
> - [ ] **P1-15** `UserMessage.content` → `string | (TextContent|ImageContent)[]`
> - [ ] **P1-16** `AssistantMessage` attribution: typed `StopReason` union, `api`/`provider` fields
> - [ ] **P1-17** Open `AgentMessage` union via declaration merging
> - [ ] **P1-18** Custom message types: `compactionSummary`, `bashExecution`, `branchSummary`, `custom`
> - [ ] **P1-20** `TextContent` add `textSignature?`
> - [ ] **P1-19** Steering/followUp → rich message types (not string queues)

> - [ ] **P1-21** `SessionStore` → entry tree with `appendCompaction`/`buildContext`/fork
>   - Biggest change in this phase — touches DB schema, repos, SqliteSessionStore, agent loop

> - [ ] **P1-10** `beforeToolCall` / `afterToolCall` hooks
> - [ ] **P1-12** `validateToolArguments` (schema validation before execute)
> - [ ] **P1-11** `prepareNextTurn` / `shouldStopAfterTurn` / `transformContext` hooks
> - [ ] **P1-13** `getApiKey` callback (per-call dynamic resolution)

### Phase 3 — Streaming fidelity + event contract (P1 streaming)

**Goal: Events are the primary data channel for the SolidJS frontend. Must be correct.**

> - [ ] **P1-1** `message_update` carries full partial message snapshot + raw provider event
> - [ ] **P1-2** Forward `text_start`/`text_end`/`thinking_start`/`thinking_end` events
> - [ ] **P1-3** Live tool progress streaming (emit during execution, not post-completion)
> - [ ] **P1-4** `agent_end` carries `messages: AgentMessage[]`

> - [ ] **P1-39** WS disconnect cleanup (abort active run, clear state)

> - [ ] **P1-5** `turn_start` timing: emit before prompt/steers
> - [ ] **P1-6** `followUp` one-at-a-time: keep remaining queued (don't permanently disable)
> - [ ] **P1-7** `followUp` check: only at outer loop boundary
> - [ ] **P1-9** Default queue modes: `"one-at-a-time"` not `"all"`

> - [ ] **P1-49** Use `response.result()` for definitive final message
> - [ ] **P1-50** Push partial message to context on `start` event (crash resilience)

### Phase 4 — Tool quality (P1 tools)

**Goal: Tools produce correct results, handle edge cases, don't block event loop.**

> - [ ] **P1-22** Edit fuzzy matching (NFKC normalization, smart quotes/dashes)
> - [ ] **P1-23** Edit safety checks (reject empty oldText, detect no-op/overlap)
> - [ ] **P1-24** Edit lone `\r` normalization
> - [ ] **P1-37** Edit access check: `existsSync` → `fsAccess(R_OK | W_OK)`

> - [ ] **P1-25** Bash: tail truncation instead of head
> - [ ] **P1-26** Bash: process-tree kill via detached spawn
> - [ ] **P1-27** Bash: remove forced 30s default timeout
> - [ ] **P1-28** Bash: append exit code status line on non-zero exit

> - [ ] **P1-31** Grep/find: async `spawn` instead of `execSync`
> - [ ] **P1-30** Grep: `rg --json` structured output instead of colon-parse
> - [ ] **P1-29** Grep: add `glob`/`literal`/`context` params
> - [ ] **P1-38** Grep: switch to `spawn` args array (eliminate flag injection)
> - [ ] **P1-32** Find: add `--full-path` when pattern contains `/`
> - [ ] **P1-33** Path normalization (`~`, unicode spaces, `@`)
> - [ ] **P1-34** Abort signal in all tools
> - [ ] **P1-35** Ls: precheck, empty/limit notices

> - [ ] **P1-36** Write: mutation queue via `realpath` (serialize symlinks)

### Phase 5 — Compaction quality (P1 compaction + retry)

**Goal: Compaction preserves useful context across summarizations.**

> - [ ] **P1-42** Iterative summary update (UPDATE_SUMMARIZATION_PROMPT + previousSummary)
> - [ ] **P1-43** Compaction summary message: `compactionSummary` role + XML framing
> - [ ] **P1-44** File operation tracking (cumulative read/modified lists in summary)
> - [ ] **P1-45** Summary template: add Constraints & Blocked sections
> - [ ] **P1-46** Stronger summarization system prompt
> - [ ] **P1-47** In-stream error retry with classification + backoff
> - [ ] **P1-48** Context-overflow recovery (compact + retry once)
> - [ ] **P1-51** `continue()` retry-from-context path
> - [ ] P2 compaction items: split-turn, maxTokens cap, thinkingLevel, shouldCompact `>` not `>=`, estimateTokens tool name

### Phase 6 — Server alignment (P1 server)

**Goal: Server robustness for desktop app usage.**

> - [ ] **P1-40** Model resolver: fallback/fuzzy/custom (5-tier resolution)
> - [ ] **P1-41** Project-context/agents-files injection (CLAUDE.md/AGENTS.md discovery)
> - [ ] P2 server items: compaction route fix, wait-for-idle abort, DB message fidelity, settings tuning

### Phase 7 — Polish (P2)

**Goal: Nice-to-haves, not blocking v1.**

> - [ ] P2 agent loop: sessionId forwarding, stream options passthrough, structured ContextUsageEstimate, capped backoff
> - [ ] P2 types/events: tool_execution_start args, tool_execution_end isError, required message payloads, typed unions, AgentState/AgentContext
> - [ ] P2 tools: ls sort order, grep/find relativization, bash temp file, edit diff/patch/firstChangedLine, write char-length, ensureTool auto-download, grep per-line truncation
> - [ ] P2 compaction: split-turn, maxTokens cap, thinkingLevel, customInstructions, shouldCompact `>`, estimateTokens tool name
> - [ ] P2 server: compaction route fix, queue introspection, session entries, auth-filtered catalog, DB message fidelity

---

## Dependency Graph (Key Relationships)

```
Phase 1 (P0 correctness)
  └─ P0-4 (tool result type) ──────┐
                                      │
Phase 2 (type alignment) ◄──────────┘
  └─ P1-21 (SessionStore tree) ──┐   │
  └─ P1-10/11/12/13 (hooks) ────┘   │
                                      │
Phase 3 (streaming) ◄────────────────┘
  └─ P1-1/2/3/4 (event fidelity)
  └─ P1-5/6/7/9 (loop behavior)
  └─ P1-39 (WS cleanup)

Phase 4 (tool quality) ── independent, can parallel with Phase 3

Phase 5 (compaction) ◄── depends on P1-21 (SessionStore) + P1-43 (compactionSummary role)

Phase 6 (server) ── independent, can parallel with Phase 5

Phase 7 (polish) ◄── depends on everything above
```

**Note:** Phase 4 (tool quality) and Phase 6 (server) are largely independent of Phase 3 (streaming). They can be worked on in parallel once Phase 2 is complete. Phase 5 (compaction) depends on the SessionStore redesign from Phase 2.
