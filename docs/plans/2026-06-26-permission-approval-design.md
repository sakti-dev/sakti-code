# Interactive Permission Approval (`ask` channel) — Design

> Companion to `2026-06-26-agent-context-and-permissions.md` (Phase 4). This
> document finalizes the design after cross-comparing opencode's implementation
> (`packages/opencode/src/permission/index.ts` + `packages/schema/src/v1/permission.ts`).

## Goal

Turn the permission engine's `"ask"` action from a hard deny (Phase 2/3
behavior) into an interactive approval: the loop pauses mid-tool, the UI shows
an approval strip (modeled on the chat-input retry strip), and the user picks
**Allow / Always / Deny**. "Always" persists an in-memory session grant so
repeated cases auto-allow.

## Cross-compare outcome (opencode proven path)

| Aspect             | opencode                                                                     | sakti decision                                                                                                                                               |
| :----------------- | :--------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Reply vocabulary   | `"once" \| "always" \| "reject"`                                             | **Adopt verbatim** (UI: Allow=once, Always, Deny=reject).                                                                                                    |
| Request fields     | `{id, sessionID, permission, patterns[], metadata, always[], tool:{callID}}` | **Adopt**; `always = patterns` (set by the loop from `tool.permissions()`).                                                                                  |
| Grants store       | in-memory `approved: Rule[]` (InstanceState-scoped, **not** DB)              | **In-memory per session** — confirmed the proven path; DB persistence is a follow-up.                                                                        |
| deny short-circuit | `deny` throws immediately, never asks                                        | Already correct (Phase 2).                                                                                                                                   |
| Sibling cascade    | reject/always cascades to same-session pending                               | **Drop** — sakti prepares tool calls sequentially (`agent-loop.ts:622`/`:693`; only _execution_ is parallel via `Promise.all:753`), so never >1 pending ask. |
| ID                 | `"per_" + ascending()`                                                       | Adopt `per_`-prefixed ascending id.                                                                                                                          |
| Events             | `permission.asked` / `permission.replied`                                    | Match field-for-field over WS.                                                                                                                               |
| Cleanup            | reject all pending on disposal (`index.ts:54-61`)                            | **Adopt** — reject pending on run end/abort.                                                                                                                 |
| Loop hook          | tools call `permission.ask()` inline                                         | Keep central declarator (Phase 2); resolver returns `Promise<"allow"                                                                                         | "deny">`. |

## Architecture & data flow

```
loop prepareToolCall (agent-loop.ts:844):
  requests = tool.permissions(args)               // [{permission, patterns}]
  for each (permission, pattern):
    action = evaluatePermission(permission, pattern)   // sync, incl. live grants
    deny  -> immediate error tool result (Phase 2 path)
    allow -> continue
    ask   -> needsResolve
  if needsResolve:
    decision = await config.resolvePermissionAsk({          // async, loop pauses
      id, sessionId, permission, patterns, always: patterns,
      tool: { callID: toolCall.id }, toolName: toolCall.name,
    })
    decision === "deny" -> error tool result
    decision === "allow" -> proceed to execute

server resolvePermissionAsk impl (bridges to WS):
  // re-check grants (race safety vs sync eval), opencode does this inside ask
  if every pattern now allow via grants -> resolve "allow" (no UI)
  else:
    deferred = new Deferred(); pending.set(id, {request, deferred})
    ws.send({type:"permission.asked", sessionId, ...request})
    return deferred.promise   // resolves with "allow"|"deny" on reply

WS in: {type:"permission.reply", sessionId, id, reply: "once"|"always"|"reject"}
  server reply handler:
    entry = pending.get(id); if !entry -> ignore (stale)
    pending.delete(id)
    switch reply:
      "reject" -> deferred.resolve("deny"); rejectOtherPendingForSession()  // safety
      "once"   -> deferred.resolve("allow")
      "always" -> grants.add({permission, patterns, "allow"}); deferred.resolve("allow")
    ws.send({type:"permission.replied", sessionId, requestID: id, reply})   // ack/UX
```

## Component breakdown

### `packages/agent` (loop hook)

- `AgentLoopConfig.resolvePermissionAsk?: (req: PermissionAskRequest) => Promise<"allow" | "deny">`
  - `PermissionAskRequest = {id; sessionId; permission; patterns; always; tool: {callID}; toolName}`
- `agent-loop.ts:844`: when sync `evaluatePermission` yields `"ask"` for any
  pattern **and** `resolvePermissionAsk` is present, `await` it; honor the
  verdict. If absent, `ask` remains `deny` (Phase 2 behavior preserved).
- Export `PermissionAskRequest` + a `PermissionReply = "once"|"always"|"reject"` type.

### `apps/server` (the bridge + grants)

- `lib/permission-channel.ts` (new): per-session `pending: Map<id, {request, deferred}>`
  - `grants: Map<sessionId, PermissionRule[]>` (the in-memory `approved`).
  * `ask(sessionId, request)`: re-check grants; if all-allowed resolve
    `"allow"`; else create Deferred, store, emit `permission.asked`, return promise.
  * `reply(sessionId, id, reply)`: resolve the Deferred (`once`→allow,
    `always`→grant+allow, `reject`→deny); emit `permission.replied`.
  * `rejectPendingForSession(sessionId)`: reject all (run end/abort finalizer).
  * `grantsFor(sessionId)`: snapshot merged into the harness evaluator.
- `runner.ts`: the harness evaluator closure becomes
  `evaluate(perm, pat, merge(agentRuleset, grantsFor(sessionId)))` so "always"
  auto-allows on the next sync eval. Wire `resolvePermissionAsk` to
  `permissionChannel.ask`. On run end/abort, call `rejectPendingForSession`.
- `ws-handler.ts`: add `permission.reply` to `WsIn`; emit `permission.asked` /
  `permission.replied` `WsOut` frames.
- `builtin-agents.ts`: flip build's `.env` read `deny -> ask`; add
  `external_directory: { "*": "ask" }` (opencode defaults) so the strip fires.

### `apps/desktop` (the strip)

- New session-store slice `store.permission: PermissionPending | null` where
  `PermissionPending = {id, toolName, permission, patterns}`.
- `stores/server/ws-client.ts`: on `permission.asked` frame → reducer sets the
  slice (scoped to the frame's sessionId); on `permission.replied` → clears it.
- `components/chat-input/permission-strip.tsx` (new): mirrors the retry strip —
  banner above the textarea, icon + "Allow `{toolName}` to `{permission}`
  `{patterns}`?" + **Allow / Always / Deny** buttons. Each sends
  `permission.reply {sessionId, id, reply}` and the slice clears.
- Mount in `chat-input.tsx` next to the `<Show when={retry()}>` block.

## Testing

- **agent**: loop `ask` calls `resolvePermissionAsk` and awaits; absent resolver → deny; allow proceeds, deny blocks.
- **server**: grants merge makes a prior "always" skip the next ask (no UI frame); `once` doesn't persist; `reject` denies; run-end finalizer rejects pending; ruleset flip (.env → ask).
- **desktop**: `PermissionStrip` renders from the slice; buttons emit the correct `permission.reply`; slice clears on `permission.replied`.

## Out of scope (tracked follow-ups)

- DB persistence of "always" grants (opencode runtime is in-memory; cross-session save is separate).
- Sibling-cascade (not needed — sequential preparation).
- Tool-exposure filtering (exclude denied tools from the LLM request) — opencode `session/llm.ts:149`.
- Chat-input autocomplete (slash / `@` files / `@` agents) — separate UI pass.
