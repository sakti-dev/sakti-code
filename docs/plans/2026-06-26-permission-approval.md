# Interactive Permission Approval (`ask` channel) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the permission engine's `"ask"` action into an interactive approval — the loop pauses mid-tool, a chat-input strip (modeled on the retry strip) offers Allow / Always / Deny, and "Always" persists an in-memory session grant.

**Architecture:** A vertical slice across three packages. (1) `packages/agent` adds an async `resolvePermissionAsk` hook to the loop (the loop already evaluates `allow`/`deny` centrally via `tool.permissions()`). (2) `apps/server` bridges that hook to WebSocket: a per-session `pending`/`grants` channel ports opencode's `permission/index.ts` Deferred shape, minus the sibling-cascade (sakti prepares tool calls sequentially). (3) `apps/desktop` renders an approval strip from a new session-store slice. Grants are in-memory (opencode's `approved[]` is `InstanceState`-scoped, not DB).

**Tech Stack:** TypeScript, vitest (TDD), typebox, Hono WS, SolidJS. Ports from `openspec/references/opencode/packages/opencode/src/permission/index.ts` + `packages/schema/src/v1/permission.ts`.

---

## PORTING DISCIPLINE

- **`[PORT]`** — logic exists in opencode at the cited path. Read it, copy, adapt (Effect → plain TS, `Bun.*` → `node:*`).
- **`[NEW]`** — no opencode equivalent; cross-compare and decide.
- **Per task:** read cited opencode source, write failing test, watch it fail, implement, watch it pass, `npx ultracite fix <files>` + per-package `pnpm run typecheck`, commit.
- **`exactOptionalPropertyTypes: true` is ON** — spread conditionally, never pass `undefined`.
- **Lint:** repo-wide `pnpm run fix` is broken by a nested `packages/velomark/biome.jsonc`; use `npx ultracite fix <files>` (or `npx @biomejs/biome check`) on touched files only.

---

## Conventions Reference

- Tests: vitest, colocated `__tests__/`. Run per-package: `cd <pkg> && pnpm run test`.
- Typecheck: per-package `pnpm run typecheck` (faster than turbo during a task).
- Existing patterns to mirror:
  - Loop permission test: `packages/agent/src/__tests__/agent-loop.test.ts:580` ("blocks a tool call when evaluatePermission denies it").
  - Harness method forwarding: `packages/agent/src/harness/agent-harness.ts` `setPermissionEvaluator` (Phase 3) — `setPermissionAskResolver` mirrors it.
  - Server runner helpers: `apps/server/src/agent/runner.ts` `buildPermissionEvaluator` / `switchAgentForSession`.
  - WS message types: `apps/server/src/agent/ws-handler.ts` (`WsIn`/`WsOut` unions + `wsBodySchema` + `handleMessage`).
  - Desktop store slice: `apps/desktop/src/stores/session/event-reducer.ts` + `session-store.ts` (`store.retry` is the slice to mirror).
  - Desktop strip UI: `apps/desktop/src/components/chat-input/chat-input.tsx:120-153` (the `<Show when={retry()}>` banner).

---

# PHASE A — Loop `ask` hook (`packages/agent`)

## Task A1: `PermissionAskRequest` type + `resolvePermissionAsk` on `AgentLoopConfig` `[NEW]`

**Files:**
- Modify: `packages/agent/src/types.ts` (add types + the optional config field, near `evaluatePermission` at `:211`)
- Test: `packages/agent/src/__tests__/agent-loop.test.ts` (add a case next to the `:580` deny test)

**Step 1 (RED):** add a test next to the existing deny test. It uses a tool whose `permissions()` returns a pattern the evaluator maps to `"ask"`, provides a `resolvePermissionAsk` stub, and asserts the resolver is awaited and `execute` runs on `"allow"`.

```ts
it("calls resolvePermissionAsk and proceeds when the ask is allowed", async () => {
  const toolSchema = Type.Object({ path: Type.String() });
  const asked: string[] = [];
  const executed: string[] = [];
  const tool: AgentTool<typeof toolSchema, undefined> = {
    name: "read",
    label: "Read",
    description: "Read",
    parameters: toolSchema,
    async execute(_id, params) {
      executed.push(params.path);
      return { content: [{ type: "text", text: "ok" }], details: undefined };
    },
    permissions: (params) => [
      { permission: "read", patterns: [(params as { path: string }).path] },
    ],
  };
  const context: AgentContext = { systemPrompt: "", messages: [], tools: [tool] };
  const config: AgentLoopConfig = {
    model: createModel(),
    convertToLlm: identityConverter,
    evaluatePermission: () => "ask",
    resolvePermissionAsk: async (req) => {
      asked.push(`${req.permission}:${req.patterns.join(",")}`);
      return "allow";
    },
  };
  const { fn: streamFn } = makeStreamFn(
    { content: [{ type: "toolCall", id: "t-1", name: "read", arguments: { path: "a.env" } }], finishReason: "toolUse" },
    { content: [{ type: "text", text: "done" }] },
  );
  const events: AgentEvent[] = [];
  for await (const e of agentLoop([createUserMessage("x")], context, config, undefined, streamFn)) events.push(e);
  expect(asked).toEqual(["read:a.env"]);
  expect(executed).toEqual(["a.env"]);
});

it("calls resolvePermissionAsk and blocks when the ask is denied", async () => {
  // same setup, resolvePermissionAsk returns "deny"; assert execute never runs
  // and the tool_execution_end is an error (mirror the :580 assertions).
});
```

**Step 2 (verify RED):** `cd packages/agent && pnpm run test src/__tests__/agent-loop.test.ts -t "resolvePermissionAsk"` → FAIL (`resolvePermissionAsk` not on type / not honored).

**Step 3 (GREEN):** in `types.ts` add:
```ts
export interface PermissionAskRequest {
  always: string[];
  patterns: string[];
  permission: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
}
export type PermissionReply = "once" | "always" | "reject";
```
and on `AgentLoopConfig` (near `evaluatePermission`):
```ts
resolvePermissionAsk?: (
  req: PermissionAskRequest
) => Promise<"allow" | "deny">;
```

**Step 4:** implement the loop change at `packages/agent/src/loop/agent-loop.ts:844` (see Task A2). Re-run → the types now compile but behavior isn't wired; both tests still fail until A2.

## Task A2: Wire the ask path into the loop `[PORT]`-guided

**PORT source:** `openspec/references/opencode/packages/opencode/src/permission/index.ts:67-107` — deny short-circuits (no ask); `ask` triggers the prompt; `allow` continues. sakti awaits `resolvePermissionAsk` **sequentially** (one pending at a time).

**Files:**
- Modify: `packages/agent/src/loop/agent-loop.ts:844-861` (replace the single `blocked` check)

**Step 1 (GREEN):** replace the existing block:
```ts
if (config.evaluatePermission && tool.permissions) {
  const requests = tool.permissions(validatedArgs) ?? [];
  let deny = false;
  const askQueue: PermissionAskRequest[] = [];
  for (const request of requests) {
    if (deny) break;
    for (const pattern of request.patterns) {
      const action = config.evaluatePermission!(request.permission, pattern);
      if (action === "deny") { deny = true; break; }
      if (action === "ask") {
        askQueue.push({
          sessionId: currentContext.sessionId ?? "",
          permission: request.permission,
          patterns: request.patterns,
          always: request.patterns,
          toolName: toolCall.name,
          toolCallId: toolCall.id,
        });
        break; // one ask per request is enough
      }
    }
  }
  if (deny) {
    return { kind: "immediate", result: createErrorToolResult(`Permission denied for tool "${tool.name}"`), isError: true };
  }
  if (askQueue.length > 0) {
    const resolver = config.resolvePermissionAsk;
    if (resolver) {
      for (const ask of askQueue) {
        if (signal?.aborted) break;
        const verdict = await resolver(ask);
        if (verdict === "deny") {
          return { kind: "immediate", result: createErrorToolResult(`Permission denied for tool "${tool.name}"`), isError: true };
        }
      }
    } else {
      // No resolver: ask behaves as deny (Phase 2 behavior preserved).
      return { kind: "immediate", result: createErrorToolResult(`Permission denied for tool "${tool.name}"`), isError: true };
    }
  }
}
```
> Note: if `currentContext` has no `sessionId` field, read it from the turn/session context that is in scope at `:844` (check the `AgentContext` shape and the surrounding `prepareToolCall` signature; pass an empty string only as last resort — prefer the real id since the server needs it to route the frame).

**Step 2 (verify GREEN):** both A1 tests pass.

**Step 3:** add a third test: `evaluatePermission` returns `"ask"` but **no** `resolvePermissionAsk` is set → tool is blocked (execute not called, error result). This locks in the Phase 2 fallback.

**Step 4:** `npx ultracite fix packages/agent/src/loop/agent-loop.ts packages/agent/src/types.ts packages/agent/src/__tests__/agent-loop.test.ts` && `cd packages/agent && pnpm run typecheck`.

**Step 5 (commit):** `feat(agent): loop resolvePermissionAsk hook (ask channel)`

## Task A3: Harness forwards `resolvePermissionAsk` `[NEW]`

The runner sets the resolver on the harness (parallel to Phase 3's `setPermissionEvaluator`). `createLoopConfig` must forward it.

**Files:**
- Modify: `packages/agent/src/harness/agent-harness.ts` (add field + setter, forward in `createLoopConfig` next to the `evaluatePermission` spread added in Phase 3)
- Test: `packages/agent/src/__tests__/harness/agent-switch.test.ts` (add a case)

**Step 1 (RED):** a test that sets `harness.setPermissionAskResolver(async () => "allow")`, runs a prompt whose tool triggers `ask` (evaluator returns `"ask"`), and asserts `execute` runs. Mirror the existing "forwards the permission evaluator" test in that file.

**Step 2 (verify RED).**

**Step 3 (GREEN):**
- field: `private permissionAskResolver?: (req: PermissionAskRequest) => Promise<"allow" | "deny">;`
- `setPermissionAskResolver(fn) { this.permissionAskResolver = fn; }`
- in `createLoopConfig`, next to the `evaluatePermission` spread:
```ts
...(this.permissionAskResolver === undefined
  ? {}
  : { resolvePermissionAsk: (req) => this.permissionAskResolver!(req) }),
```

**Step 4 (verify GREEN). Step 5:** fix + typecheck. **Step 6 (commit):** `feat(agent): harness forwards resolvePermissionAsk to the loop`

---

# PHASE B — Server permission channel (`apps/server`)

## Task B1: The permission channel (pending + grants) `[PORT]`

**PORT source:** `openspec/references/opencode/packages/opencode/src/permission/index.ts:42-167` — the `pending: Map<id, {info, deferred}>` + `approved: Rule[]`, `ask` (re-check approved, else create Deferred + publish + await), `reply` (once/always/reject), and the disposal finalizer (`:54-61`). **Drop the sibling-cascade** (`:129-138`, `:153-166`) — sakti prepares tools sequentially.

**Files:**
- Create: `apps/server/src/lib/permission-channel.ts`
- Test: `apps/server/src/lib/__tests__/permission-channel.test.ts`

**Step 1 (RED):** tests covering: (a) `ask` with no prior grant returns a promise that does not resolve until `reply`; the `onAsked` callback fires with `{id, permission, patterns, toolName, toolCallId}`. (b) `reply(id, "once")` resolves the promise with `"allow"` and does **not** add a grant. (c) `reply(id, "always")` resolves `"allow"` **and** adds a grant so a subsequent `ask` for the same `(permission, pattern)` resolves `"allow"` immediately without `onAsked` firing. (d) `reply(id, "reject")` resolves `"deny"`. (e) `rejectPendingForSession(sessionId)` resolves all pending as `"deny"`.

```ts
import { describe, expect, it } from "vitest";
import { createPermissionChannel } from "../permission-channel.ts";

describe("permission channel", () => {
  it("asks, then resolves allow on 'once' without persisting", async () => {
    const asked: any[] = [];
    const ch = createPermissionChannel({ onAsked: (f) => asked.push(f) });
    const p = ch.ask("s1", { permission: "read", patterns: ["a.env"], always: ["a.env"], toolName: "read", toolCallId: "c1" });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ sessionId: "s1", permission: "read", patterns: ["a.env"], toolName: "read" });
    ch.reply("s1", asked[0].id, "once");
    expect(await p).toBe("allow");
    // no grant persisted: a second ask for the same pattern asks again
    const p2 = ch.ask("s1", { permission: "read", patterns: ["a.env"], always: ["a.env"], toolName: "read", toolCallId: "c2" });
    expect(asked).toHaveLength(2);
    ch.reply("s1", asked[1].id, "reject");
    expect(await p2).toBe("deny");
  });

  it("'always' persists a grant so the next ask auto-allows (no frame)", async () => {
    const asked: any[] = [];
    const ch = createPermissionChannel({ onAsked: (f) => asked.push(f) });
    const p = ch.ask("s1", { permission: "read", patterns: ["*.env"], always: ["*.env"], toolName: "read", toolCallId: "c1" });
    ch.reply("s1", asked[0].id, "always");
    expect(await p).toBe("allow");
    const p2 = ch.ask("s1", { permission: "read", patterns: ["x.env"], always: ["x.env"], toolName: "read", toolCallId: "c2" });
    expect(asked).toHaveLength(1); // no new ask
    expect(await p2).toBe("allow");
  });

  it("rejectPendingForSession denies all pending", async () => {
    const ch = createPermissionChannel({ onAsked: () => {} });
    const p = ch.ask("s1", { permission: "read", patterns: ["a"], always: ["a"], toolName: "read", toolCallId: "c1" });
    ch.rejectPendingForSession("s1");
    expect(await p).toBe("deny");
  });
});
```

**Step 2 (verify RED).**

**Step 3 (GREEN, PORT):** implement `createPermissionChannel({ onAsked })`:
- `grants: Map<sessionId, PermissionRule[]>`, `pending: Map<id, { request, resolve }>`.
- `ask(sessionId, req)`: evaluate each pattern against `merge([], grantsFor(sessionId))` using the agent package's `evaluate`; if all `allow` → resolve `"allow"` immediately; else generate `id = "per_" + (++seq)`, store pending, call `onAsked({ id, sessionId, ...req })`, return a promise resolved by `reply`.
- `reply(sessionId, id, reply)`: lookup pending; `"once"`→resolve allow; `"always"`→push grant `{permission, pattern:"*", action:"allow"}` per pattern in `req.always` (use the specific patterns, not `"*"`), resolve allow; `"reject"`→resolve deny.
- `rejectPendingForSession(sessionId)`: resolve all pending for that session as deny.
- Import `evaluate`, `merge`, `type PermissionRule` from `@sakti-code/agent`.
- `grantsFor(sessionId)` exported for the runner to merge into the evaluator.

> Use a manual deferred (`let resolve; const p = new Promise(r => { resolve = r; })`) — no `effect`/`Deferred` dep.

**Step 4 (verify GREEN). Step 5:** fix + `cd apps/server && pnpm run typecheck`. **Step 6 (commit):** `feat(server): permission channel (pending + in-memory grants)`

## Task B2: Runner wires evaluator (with grants) + ask resolver + run-end finalizer `[NEW]`

**Files:**
- Modify: `apps/server/src/agent/runner.ts` (harness evaluator closure + `setPermissionAskResolver` + finalizer)

**Step 1 (RED):** extend `apps/server/src/agent/__tests__/switch-agent.test.ts` (or a new `runner-permission.test.ts`) — unit-test `buildPermissionEvaluatorWithGrants` (a thin wrapper) so that after a grant is added, a previously-`ask` pattern evaluates `allow`. (The full ask round-trip is covered by B1; here we only assert the evaluator reads live grants.)

**Step 2 (verify RED).**

**Step 3 (GREEN):** in `runPrompt`, after resolving the agent:
- create one `permissionChannel` per run (or per session — a module-level `Map<sessionId, channel>` so WS replies route correctly; simplest correct: module-level `getPermissionChannel(sessionId)` singleton per session).
- evaluator closure: `(permission, pattern) => evaluate(permission, pattern, merge(agentRuleset, channel.grantsFor(sessionId))).action`
- `harness.setPermissionEvaluator(evaluator)`
- `harness.setPermissionAskResolver((req) => channel.ask(sessionId, req))` with `onAsked` = `(frame) => wsSend permission.asked` — but the runner doesn't own `ws`. So `onAsked` must be wired where `ws` is: pass an `onAsked` callback into `runPrompt` (extend its signature) OR have the channel emit via the existing `eventCallback`. **Decision:** extend `runPrompt` to accept `permissionAskedSink` (mirrors `eventCallback`); `ws-handler.runAgentStream` passes a sink that sends the `permission.asked` frame.

**Step 4 (verify GREEN). Step 5:** fix + typecheck. **Step 6 (commit):** `feat(server): wire permission ask resolver + grants into the runner`

## Task B3: WS `permission.reply` in + `permission.asked`/`.replied` out `[PORT]`

**PORT source:** wire shapes — `schema/v1/permission.ts:61-65` (`Asked` = Request fields; `Replied` = `{sessionID, requestID, reply}`).

**Files:**
- Modify: `apps/server/src/agent/ws-handler.ts` (`WsIn` + `WsOut` + `wsBodySchema` + `handleMessage`)
- Modify: `apps/server/src/agent/runner.ts` (`runPrompt` signature + `runAgentStream` sink)
- Test: `apps/server/src/agent/__tests__/ws-types.test.ts` (add schema cases)

**Step 1 (RED):** test that `handleMessage` with `{type:"permission.reply", sessionId, id, reply:"allow"}` calls `permissionChannel.reply`. (Inject/resolve the channel via the runner module; mirror how `handleMessage` already calls `switchAgentForSession`.)

**Step 2 (verify RED).**

**Step 3 (GREEN):**
- `WsIn`: add `{ type:"permission.reply"; sessionId:string; id:string; reply:"once"|"always"|"reject" }`.
- `wsBodySchema`: add the matching `Type.Object`.
- `WsOut`: add `PermissionAskedFrame { type:"permission_asked"; sessionId; id; permission; patterns:string[]; toolName; toolCallId }` and `PermissionRepliedFrame { type:"permission_replied"; sessionId; id; reply }`.
- `handleMessage`: add a `msg.type === "permission.reply"` branch → `getPermissionChannel(msg.sessionId).reply(msg.sessionId, msg.id, msg.reply)`; on unknown id, ignore (stale).
- `runAgentStream`: pass `permissionAskedSink = (frame) => ws.send({ type:"permission_asked", ...frame })` into `runPrompt`; after `runPrompt` resolves, the channel's `onAsked` is already bound to that sink.

**Step 4 (verify GREEN). Step 5:** fix + typecheck. **Step 6 (commit):** `feat(server): WS permission.asked/replied channel`

## Task B4: Flip build ruleset so `ask` actually fires `[PORT]`

**PORT source:** `agent/agent.ts:119-135` (opencode defaults: `read *.env → ask`, `external_directory * → ask`).

**Files:**
- Modify: `apps/server/src/agent/builtin-agents.ts` (`buildRuleset`)
- Test: `apps/server/src/agent/__tests__/builtin-agents.test.ts` (update the build `.env` expectation from `deny` to `ask`)

**Step 1 (RED):** change the build `.env` assertion to `toBe("ask")` → FAIL (currently `deny`).

**Step 2 (GREEN):** in `buildRuleset()`:
```ts
return fromConfig({
  "*": "allow",
  read: { "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" },
  external_directory: { "*": "ask" },
});
```

**Step 3 (verify GREEN). Step 4:** fix + typecheck. **Step 5 (commit):** `feat(server): build agent asks on .env reads + external dirs`

---

# PHASE C — Desktop approval strip (`apps/desktop`)

## Task C1: Session-store `permission` slice + ws-client wiring `[NEW]`

**Files:**
- Modify: `apps/desktop/src/stores/session/session-store.ts` (add `permission` slice; mirror `retry`)
- Modify: `apps/desktop/src/stores/session/event-reducer.ts` (or `ws-client.ts` — wherever non-event frames are handled) — handle `permission_asked` (set slice) + `permission_replied` (clear slice)
- Test: `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts` (add cases)

**Step 1 (RED):** test that a `permission_asked` frame sets `store.permission = {id, toolName, permission, patterns}` and `permission_replied` clears it.

**Step 2 (verify RED).**

**Step 3 (GREEN):**
- slice: `permission: { id:string; toolName:string; permission:string; patterns:string[] } | null`
- actions: `setPermission(req)`, `clearPermission()`
- ws-client `handleFrame`: add `case "permission_asked"` → dispatch set; `case "permission_replied"` → dispatch clear.

**Step 4 (verify GREEN). Step 5:** fix + `cd apps/desktop && pnpm run typecheck`. **Step 6 (commit):** `feat(desktop): permission pending session-store slice`

## Task C2: `PermissionStrip` component `[NEW]`

**Files:**
- Create: `apps/desktop/src/components/chat-input/permission-strip.tsx`
- Test: `apps/desktop/src/components/chat-input/__tests__/permission-strip.test.tsx`

**Step 1 (RED):** render the strip with a pending request; assert it shows "Allow `read` to read `a.env`?" and that clicking Allow/Deny/Always calls the WS `send` with the right `{type:"permission.reply", id, reply}`. Mirror `chat-input.test.tsx` setup (props-driven, no StoreProvider).

```tsx
it("sends permission.reply allow on Allow click", async () => {
  const sent: any[] = [];
  render(() => (
    <PermissionStrip
      sessionId="s1"
      request={{ id: "per_1", toolName: "read", permission: "read", patterns: ["a.env"] }}
      send={(m) => sent.push(m)}
    />
  ));
  await fireEvent.click(screen.getByText("Allow"));
  expect(sent[0]).toMatchObject({ type: "permission.reply", sessionId: "s1", id: "per_1", reply: "once" });
});
```

**Step 2 (verify RED).**

**Step 3 (GREEN):** mirror the retry strip markup (`chat-input.tsx:120-153`): banner with icon + the question + three buttons (Allow / Always / Deny). Allow→`reply:"once"`, Always→`reply:"always"`, Deny→`reply:"reject"`.

**Step 4 (verify GREEN). Step 5:** fix + typecheck. **Step 6 (commit):** `feat(desktop): PermissionStrip approval banner`

## Task C3: Mount the strip in `chat-input.tsx` `[NEW]`

**Files:**
- Modify: `apps/desktop/src/components/chat-input/chat-input.tsx` (read `sessionStore()?.store.permission`; render `<PermissionStrip>` next to the retry `<Show>`)
- Test: `apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx` (add a case asserting the strip renders when the slice is set)

**Step 1 (RED) → Step 2 (verify) → Step 3 (GREEN):** add:
```tsx
const permission = () => sessionStore()?.store.permission ?? null;
// ...inside the layout, above the input box, after the retry <Show>:
<Show when={permission()}>
  {(req) => <PermissionStrip sessionId={props.sessionId} request={req()} send={actions.sendWs} />}
</Show>
```
> If `actions` has no `sendWs`, use the existing ws send path used elsewhere in the app (check `stores/server/ws-client.ts` for the exposed sender and thread it via the store/actions — mirror how `sendPrompt` reaches the ws).

**Step 4 (verify GREEN). Step 5:** fix + typecheck. **Step 6 (commit):** `feat(desktop): mount PermissionStrip in chat input`

---

# PHASE D — Verification

## Task D1: End-to-end checkpoint

- [ ] `cd packages/agent && pnpm run test` green (loop ask + harness forwarding).
- [ ] `cd packages/agent && pnpm run typecheck` clean.
- [ ] `cd apps/server && pnpm run test` green (channel + ws + ruleset flip; pre-existing compaction/terminal environmental fails remain).
- [ ] `cd apps/server && pnpm run typecheck` clean.
- [ ] `cd apps/desktop && pnpm run test` green; typecheck clean.
- [ ] `pnpm run typecheck` (turbo) green across all packages.
- [ ] No `effect`/`Deferred`/`gray-matter` imports introduced.
- [ ] Manual (when runnable): with the build agent, trigger a `.env` read → strip appears → Allow proceeds, Always skips the next `.env` read, Deny blocks the tool.

---

## Open Follow-ups (out of scope)
- DB persistence of "always" grants (opencode runtime is in-memory).
- Sibling-cascade (not needed — sequential preparation).
- Tool-exposure filtering (exclude denied tools from the LLM request) — opencode `session/llm.ts:149`.
- Chat-input autocomplete (slash / `@` files / `@` agents) — separate UI pass.
