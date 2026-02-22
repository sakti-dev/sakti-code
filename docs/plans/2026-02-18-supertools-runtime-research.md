# Supertools Runtime Research Dump

Date: 2026-02-18  
Author: Codex session notes

## Goal

Capture everything learned from scanning `./supertools`, especially the sandbox + relay + programmatic tool execution model, and map it to `sakti-code`.

## Scope

This document is based on code and docs in:

- `supertools/README.md`
- `supertools/packages/core/src/*`
- `supertools/e2b-templates/*`
- `supertools/examples/*`

And compared against relevant `sakti-code` runtime files:

- `packages/core/src/session/controller.ts`
- `packages/core/src/session/processor.ts`
- `packages/core/src/tools/registry.ts`
- `packages/core/src/agent/workflow/model-provider.ts`
- `packages/server/src/routes/chat.ts`

## Executive Summary

Supertools implements the exact pattern discussed:

- LLM generates JavaScript code once.
- Code runs in an isolated sandbox.
- Code calls tools through `mcp.call("server.tool", args)`.
- Host tools execute outside sandbox via authenticated relay.
- Intermediate tool data stays out of model context.

Main caveat:

- It is architecturally model-agnostic at the execution layer, but SDK wrapping is currently Anthropic-only (`supertools/packages/core/src/supertools.ts:60`).

Direction update from `sandboxing.md`:

- For `sakti-code`, prefer a **local sandbox worker** (`child_process` + `isolated-vm`) over remote endpoint-style execution.
- Feed programmatic execution through a normal **AI SDK tool call** (e.g. `sandbox_execute`) so the approach remains provider/model agnostic.

## Core Architecture

### High-level shape

1. Wrap provider SDK client.
2. Intercept chat generation call.
3. Generate executable JS from user request + tool docs.
4. Run JS in sandbox (E2B template with prestarted relay server).
5. Route tool calls from sandbox to host through WebSocket.
6. Return final execution result.

### Main modules

- Wrapper entrypoint: `supertools/packages/core/src/supertools.ts`
- Anthropic wrapper: `supertools/packages/core/src/providers/anthropic.ts`
- Execution orchestration: `supertools/packages/core/src/executor.ts`
- Tool definition and normalization: `supertools/packages/core/src/tool.ts`
- MCP docs + prompt builder: `supertools/packages/core/src/mcp/prompts.ts`
- Zod to MCP conversion: `supertools/packages/core/src/mcp/zod-to-mcp.ts`
- Host relay client: `supertools/packages/core/src/relay/client.ts`
- Sandbox relay server: `supertools/e2b-templates/files/relay.ts`
- Sandbox MCP router: `supertools/e2b-templates/files/mcp-router.ts`
- Fixed template alias: `supertools/packages/core/src/constants.ts`

## End-to-End Flow (Concrete)

### 1) SDK intercept

`wrapAnthropicClient()` proxies `messages.create`, extracts the last user message, and runs programmatic execution instead of normal tool-calling:

- Intercept path: `supertools/packages/core/src/providers/anthropic.ts:145`
- User message extraction: `supertools/packages/core/src/providers/anthropic.ts:155`

### 2) Code generation + relay connect (parallelized)

`ProgrammaticExecutor.run()` does:

- create auth token
- compute relay URL from sandbox host
- start codegen and relay websocket connection in parallel

Reference:

- `supertools/packages/core/src/executor.ts:66`
- `supertools/packages/core/src/executor.ts:83`

### 3) Code execution in sandbox

Executor sends generated code to relay server with local tool code map:

- `relayClient.execute(code, [], localToolsCache)`
- `supertools/packages/core/src/executor.ts:139`

Sandbox relay uses `AsyncFunction(..., code)` and binds only `mcp.call`:

- `supertools/e2b-templates/files/relay.ts:114`
- `supertools/e2b-templates/files/relay.ts:138`

### 4) Tool routing

Inside sandbox:

- `mcp.call("host.tool", args)` -> remote relay call
- `mcp.call("local.tool", args)` -> local in-sandbox function

Reference:

- `supertools/e2b-templates/files/mcp-router.ts:42`
- `supertools/e2b-templates/files/mcp-router.ts:48`

### 5) Host tool execution

Host relay client receives `tool_call`, looks up normalized tool, runs `tool.execute(args)`, sends `tool_result`:

- `supertools/packages/core/src/relay/client.ts:252`
- `supertools/packages/core/src/relay/client.ts:268`

### 6) Final result

Relay returns `result` message; wrapper constructs Anthropic-shaped response with text content and usage:

- `supertools/packages/core/src/providers/anthropic.ts:175`

## Tool Model

### defineTool contract

Tools are defined with:

- `name`
- `description`
- `parameters` (Zod schema)
- optional `returns` (Zod schema)
- `execute(params)`
- optional `local: true`

Reference:

- `supertools/packages/core/src/tool.ts`

### Local vs host tools

- Host tools: execute on your machine through relay.
- Local tools: function body serialized and executed in sandbox.

References:

- Local serialization: `supertools/packages/core/src/tool.ts:141`
- Local registration in sandbox: `supertools/e2b-templates/files/relay.ts:130`
- Local function compilation: `supertools/e2b-templates/files/relay.ts:155`

### Schema conversion for prompting

Zod schemas are converted to MCP-like JSON schema docs for code generation:

- `supertools/packages/core/src/mcp/zod-to-mcp.ts:18`

## Prompt Strategy

System prompt strongly constrains generated code style:

- Prefer `Promise.all` for independent calls.
- Return code block only.
- Use `mcp.call("server.tool", args)` convention.

Reference:

- `supertools/packages/core/src/mcp/prompts.ts:16`
- `supertools/packages/core/src/mcp/prompts.ts:21`
- `supertools/packages/core/src/mcp/prompts.ts:73`

## Relay Protocol

### Transport

- WebSocket with bearer token auth (`Authorization: Bearer <token>`)
- Binary protobuf message encoding

References:

- Host client connect auth header: `supertools/packages/core/src/relay/client.ts:144`
- Sandbox auth check: `supertools/e2b-templates/files/relay.ts:222`
- Binary codec: `supertools/packages/core/src/relay/proto/codec.ts`

### Message types

- `execute`
- `tool_call`
- `tool_result`
- `result`
- `error`
- `ping`/`pong`

Reference:

- `supertools/packages/core/src/relay/proto/codec.ts`

## Sandbox Template Model

They rely on a prebuilt E2B template alias:

- `SANDBOX_TEMPLATE = "supertools-bun-020"`
- `supertools/packages/core/src/constants.ts:6`

Template contains:

- Bun runtime
- pre-copied relay server files
- prestarted relay command

Reference:

- `supertools/e2b-templates/template.ts:12`

## Observed Strengths

- Very low round-trip overhead for multi-tool workflows.
- Clear split between sandbox compute and host-side privileged tools.
- Good event telemetry (`tool_call`, `tool_result`, `execution_error`, etc.).
- Good prompt/tool-doc generation for deterministic code style.
- Supports local pure-compute tools to avoid network relay cost.

## Observed Weaknesses / Risks

### Provider support is narrow

- Only Anthropic wrapper is implemented today.
- `SupportedProvider = "anthropic"` in `supertools/packages/core/src/supertools.ts:60`.

### Not fully conversational by default

- Main path returns execution data.
- Chat example uses second LLM call to summarize.
- `supertools/examples/chat/index.ts:54`

### Runtime arg validation is weak

- `tool.execute(args)` is called directly on host.
- No enforced runtime `schema.parse(args)` gate at execution point.
- `supertools/packages/core/src/relay/client.ts:268`

### Local tool execution is code-injection-prone if misused

- Local tools serialized to source and recompiled with `new Function`.
- `supertools/e2b-templates/files/relay.ts:161`

### Execution guardrails are basic

- Timeout and message size exist.
- No deep policy layer for per-tool budgets, side-effect classes, or explicit approval hooks in this codebase.

## README Claims and Important Notes

### Claimed advantage over Anthropic programmatic tool calling

README states Anthropic still requires API round-trips per tool result, whereas supertools keeps tool execution inside one request with websocket relay.

Reference:

- `supertools/README.md:328`

### Chat UX tradeoff acknowledged

README explicitly notes output is raw data oriented and may need extra summarization step for chatbot UX.

Reference:

- `supertools/README.md:330`

## Mapping to sakti-code Runtime

### Current sakti-code architecture highlights

- Agent loop: `streamText(...)` in `packages/core/src/session/processor.ts:515`
- Tool events/results wired in loop: `packages/core/src/session/processor.ts:736`
- Message persistence of tool context: `packages/core/src/session/processor.ts:939`
- Provider runtime injected per chat request: `packages/server/src/routes/chat.ts:1743`
- Tool registry surface: `packages/core/src/tools/registry.ts:61`

### Compatibility observation

sakti-code already has:

- Strong tool registry
- Context + permission model
- Event stream model
- Provider runtime abstraction

So supertools-like execution can be layered without replacing core agent architecture.

## Local Sandboxing Notes (`sandboxing.md`)

The `sandboxing.md` guidance aligns with a local execution model:

- Electron/UI -> local runtime -> sandbox worker process.
- Avoid treating sandbox execution as a user-facing REST endpoint in the hot path.
- Use process isolation for untrusted generated code.
- Prefer `isolated-vm` over `vm2` due to ongoing escape risk in `vm2`.

Key takeaway:

- The best fit for `sakti-code` is to expose sandbox orchestration as an internal AI SDK tool, not as a separate agent endpoint protocol.

## Recommended sakti-code Design Direction (Model-Agnostic)

### Keep existing agent loop, add one optional super-executor tool

Add a tool such as `sandbox_execute`:

- Input: task/problem + optional constraints.
- Runtime: generate code with selected model/provider.
- Execution: local sandbox worker + host tool bridge + `mcp.call`.
- Output: compact execution result and trace summary.

This preserves compatibility with any LLM that can call at least one tool.

### Prefer tool-fed execution over endpoint orchestration

Recommended flow:

1. Primary agent runs in existing `streamText` loop.
2. Agent calls `sandbox_execute` (AI SDK tool) when high-throughput orchestration is needed.
3. `sandbox_execute` spawns/borrows a local sandbox worker process.
4. Worker executes generated code under `isolated-vm` with strict limits.
5. Tool calls from sandbox resolve against host tool registry via in-process/IPC bridge.
6. Final compact result is returned as the tool output back to the agent loop.

This avoids adding a separate public `/agent/run` style orchestration API as the primary integration path.

### Required components

1. Sandbox manager abstraction.
2. Worker bridge (IPC-first; websocket optional) for sandbox <-> host tool calls.
3. Tool exposure adapter from sakti-code tools -> MCP-callable interface.
4. Codegen adapter interface for provider-specific request shape.
5. Policy layer for:
   - tool allowlist
   - max calls per run
   - max runtime
   - max output bytes
   - permission escalation routing

### Strongly recommended hardening

- Validate tool args with schema at execution edge.
- Separate read-only and mutating tool classes.
- Require explicit approval hooks for dangerous classes.
- Disable local tool source injection by default.
- Add run audit record: generated code, tool calls, durations, exit status.
- Enforce per-run resource limits (wall time, CPU, memory, output bytes).
- Run generated code in short-lived child processes.
- Keep sandbox globals minimal (only required bridge primitives).

### Suggested minimal execution contract

For `sandbox_execute` output:

- `success: boolean`
- `result: unknown` (compact payload only)
- `trace: { toolCalls: number; durationMs: number; truncated: boolean }`
- `error?: string`

For sandbox bridge tool call envelope:

- `toolName: string`
- `args: unknown`
- `callId: string`

### Proposed `sandbox_execute` Tool Contract (v0)

Input shape:

```json
{
  "objective": "implement login page",
  "phase": "discover",
  "limits": {
    "maxToolCalls": 40,
    "maxDurationMs": 120000,
    "maxReadBytes": 2000000,
    "maxResultBytes": 100000
  },
  "workspace": {
    "root": "/abs/path/to/workspace",
    "includeGlobs": ["src/**"],
    "excludeGlobs": ["dist/**", "node_modules/**"]
  },
  "writePolicy": {
    "allowCreate": true,
    "allowDelete": false,
    "allowedPaths": ["src/**", "packages/**"]
  },
  "outputMode": "summary"
}
```

Input field notes:

- `objective`: natural-language task that sandbox code should solve.
- `phase`: `discover | write` (used to select host tool whitelist).
- `limits`: hard resource/cost controls for this run.
- `workspace`: optional path and glob constraints.
- `writePolicy`: only used in `write` phase.
- `outputMode`: `summary | summary_and_patch`.

Output shape:

```json
{
  "success": true,
  "phase": "discover",
  "summary": "Found auth routes and UI structure for login implementation.",
  "filesRead": ["src/app/routes.tsx", "src/features/auth/Login.tsx"],
  "toolUsage": {
    "totalCalls": 14,
    "byTool": {
      "ls": 2,
      "glob": 3,
      "grep": 5,
      "read": 4
    },
    "durationMs": 1834,
    "truncated": false
  },
  "patch": null,
  "proposedEdits": [
    {
      "path": "src/features/auth/LoginPage.tsx",
      "action": "create",
      "reason": "Add route-level login page UI"
    }
  ],
  "error": null,
  "needsEscalation": null
}
```

Output field notes:

- `summary`: compact explanation for parent agent.
- `filesRead`: deterministic trace for auditability.
- `toolUsage`: usage and latency accounting.
- `patch`: populated if `outputMode=summary_and_patch`.
- `proposedEdits`: optional edit plan emitted during discovery.
- `needsEscalation`: set when objective cannot be completed under current phase/tool policy.

### Minimal Host Tool Whitelist by Phase

`discover` phase:

- `ls`
- `glob`
- `grep`
- `read`
- `ast-query` (optional, TS-heavy repos)

`write` phase:

- `ls`
- `glob`
- `grep`
- `read`
- `apply_patch`

Default deny (unless explicitly enabled):

- `bash`
- `write`
- `edit`
- `multiedit`
- `webfetch`
- `task`
- `task-parallel`
- `skill`

### Source Code Access Model (Important)

Sandbox does **not** get direct project filesystem access.

- Sandbox code calls `mcp.call("host.read" | "host.glob" | "host.grep" | ...)`.
- Host resolves those calls against real workspace using existing permission manager.
- Writes happen via whitelisted mutators only (prefer `apply_patch`).
- This keeps source access auditable and policy-controlled while still enabling multi-step discovery/editing.

## Subagent-Orchestrator Behavior (Current sakti-code)

If the "orchestrator" is itself a subagent, behavior depends on how that subagent was created.

### Important split: registry agents vs task-spawned subagents

1. Top-level session agent is created from runtime mode (`plan` or `build`) via `createAgent(runtimeMode, ...)`:
   - `packages/core/src/session/controller.ts:82`
   - `packages/core/src/session/controller.ts:86`
2. Registry `plan` agent includes orchestration tools (`task`, `task-parallel`):
   - `packages/core/src/agent/registry.ts:191`
   - `packages/core/src/agent/registry.ts:192`
3. But `task`-spawned subagents do **not** use registry tool lists; they load tools from `phase-tools`:
   - `packages/core/src/tools/task.ts:296`
   - `packages/core/src/tools/task.ts:412`
4. In `phase-tools`, both `explore` and `plan` map to read-only tool set (no `task`):
   - `packages/core/src/tools/phase-tools.ts:53`
   - `packages/core/src/tools/phase-tools.ts:55`

Net effect:

- A top-level `plan` agent can orchestrate.
- A `task`-spawned `plan` or `explore` subagent cannot spawn further subagents under current defaults.

### Additional runtime policy

- In persisted runtime `plan` mode, `task` enforces spawn-only-`explore`:
  - `packages/core/src/tools/task.ts:286`
  - `packages/core/src/tools/task.ts:287`

### Session/thread context nuance

- `task` passes `parentSessionId` and `parentMessageId` into child input context metadata:
  - `packages/core/src/tools/task.ts:328`
  - `packages/core/src/tools/task.ts:329`
- Memory/thread resolution in `AgentProcessor` is based on `threadId` or `sessionId`, falling back to current `Instance.context.sessionID`:
  - `packages/core/src/session/processor.ts:1056`
  - `packages/core/src/session/processor.ts:1060`
  - `packages/core/src/session/processor.ts:1061`

Implication:

- Parent linkage is available as metadata, but subagent memory often shares the same thread unless explicitly separated.

### If enabling subagent-as-orchestrator later

Require explicit controls before allowing recursive task spawning:

- max spawn depth (for example 2)
- per-child max tool calls
- global per-request tool-call budget
- strict child-type allowlist by mode
- timeout and cancellation propagation
- deterministic trace of parent->child call tree

Without these controls, recursion risk and token/tool-call blowups are high.

## Quick Difference Table

| Area                       | Supertools                           | sakti-code today                      |
| -------------------------- | ------------------------------------ | ------------------------------------- |
| Main mode                  | Generate code and execute externally | Iterative model tool-calling loop     |
| Tool transport             | WebSocket relay (protobuf)           | Direct AI SDK tool execution          |
| Provider abstraction       | Partial (Anthropic wrapper now)      | Broader provider runtime plumbing     |
| Memory/session integration | Minimal                              | Rich session/memory system            |
| Permissions                | Basic in this repo                   | Existing permission manager and rules |
| Chat UX                    | Needs optional summarization pass    | Native conversational loop            |

## Practical Takeaway

Your proposed architecture is feasible and validated by supertools:

- Sandbox + tool relay is real and works.
- It can reduce token and latency costs for tool-heavy workflows.
- It needs strong policy/validation to be production-safe.

For sakti-code, best path is hybrid:

- Keep current normal agent loop.
- Add `sandbox_execute` tool for heavy orchestration tasks.
- Route by heuristic or explicit user instruction.
- Back it with a local worker sandbox (`isolated-vm` + child process) and host tool bridge.

## References (Primary Files)

- `supertools/packages/core/src/supertools.ts`
- `supertools/packages/core/src/providers/anthropic.ts`
- `supertools/packages/core/src/executor.ts`
- `supertools/packages/core/src/tool.ts`
- `supertools/packages/core/src/mcp/prompts.ts`
- `supertools/packages/core/src/mcp/zod-to-mcp.ts`
- `supertools/packages/core/src/relay/client.ts`
- `supertools/packages/core/src/relay/proto/codec.ts`
- `supertools/e2b-templates/files/relay.ts`
- `supertools/e2b-templates/files/mcp-router.ts`
- `supertools/e2b-templates/template.ts`
- `supertools/README.md`
- `sandboxing.md`
