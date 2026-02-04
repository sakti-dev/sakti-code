Below is a **build spec** for recreating the “Antigravity IDE / Planning mode” **single big grouped block** UI (title → files edited → progress updates), plus a **server+client streaming guide** using **Vercel AI SDK v6 UIMessage streams**.

---

## 1) UX spec: “Planning / Implementing Run Card” (the big grouped block)

### 1.1 When to show the Run Card

A Run Card is a **structured assistant message** that replaces (or dominates) normal markdown when:

* user selects **mode = Planning** (or Implementing)
* the agent is doing **multi-step work** (browse, analyze, plan, edit files, run commands, etc.)
* you want **streamed progress visibility** (not just final text)

Implementation detail: render it as a **custom `data-*` part** inside the assistant message’s `parts[]` (recommended), so it streams and reconciles like any other UIMessage content. AI SDK supports arbitrary `data-*` parts. ([AI SDK][1])

---

## 2) Run Card layout (pixel/interaction spec)

### 2.1 Card header

**Header row**

* Left: `Run Title` (e.g. “Planning Desktop-Agent Integration” / “Implementing Phase 1: Types and API Client”)
* Optional subtitle (1–2 lines): a concise summary of what happened (“Explored repo structure… Identified server routes…”)

  * This subtitle can be streamed/updated as more is learned.

**Right-side status chip**

* `Planning` / `Implementing` / `Reviewing` / `Done` / `Error`
* Optional timer (elapsed)

### 2.2 Files Edited section

A compact list (like Antigravity):

* Section title: **Files Edited**
* Each row shows:

  * icon: file / folder / doc / task
  * filename (monospace-ish)
  * optional tags (“Task”, “Implementation Plan”, “Open diff”, “View”)
  * optional diff stats `+220 -431` (if you have it)
* Clicking a file triggers your Electron action: open in editor, open diff view, open docs viewer.

### 2.3 Progress Updates section

**Section header row**

* Left: **Progress Updates**
* Right: “Collapse all” (toggles all groups)

**Groups**

* Each group has:

  * numeric prefix `1`, `2`, `3`…
  * group title (e.g. “Exploring the codebase structure…”)
  * a caret to expand/collapse
* Group body is a list of **progress items**.

**Progress item row types**
You want a small fixed set so UI stays consistent:

1. **Analyzed**

* icon: magnifier / file
* label: `Analyzed packages/server/src/routes`
* optional anchor: `#L1-L338`

2. **Created / Edited / Deleted**

* icon: plus / pencil / trash
* label: `Created api-client.ts`
* diff stats + action: “Open diff”

3. **Terminal**

* icon: terminal
* collapsed code block by default
* shows command + output + exit code + “Open Terminal”

4. **Error**

* red icon
* short reason + “details” expansion

5. **Narration line**

* plain sentence inserted between rows (“Now let me verify Phase 2 compiles…”)

### 2.4 “Thought for Xs” micro-header

This is *not* the model’s hidden chain-of-thought. It’s a UX affordance:

* Show `Thought for 4s` if time-to-first-meaningful-update exceeds a threshold (say 700ms).
* Optionally allow a collapsed “thinking summary” line like: “Explored packages/core, packages/server…”

AI SDK stream protocol supports “reasoning-*” parts, but you should only use them if you explicitly want to show reasoning content. ([AI SDK][1])
(If you want an Antigravity-like UX, I recommend you stream **a short “thinking summary” as a custom `data-*` part** instead.)

---

## 3) Data model spec (what you stream + what you render)

### 3.1 Typed UIMessage

AI SDK v6 lets you type UIMessage with **metadata + data-parts + tools**. ([AI SDK][2])

You’ll use:

* **metadata** for message-level info (mode, timestamps, usage, etc.). ([AI SDK][3])
* **data parts** for the Run Card + progress updates (streamed & reconcilable). ([AI SDK][4])

### 3.2 Recommended schema (conceptual)

**Message metadata**

* `mode: "planning" | "implementing" | "chat"`
* `runId: string`
* `startedAt: number`
* `firstUpdateAt?: number`
* `elapsedMs?: number`
* `finishReason?: string`
* `usage?: { inputTokens; outputTokens; totalTokens }`

**Data parts (persistent)**

* `data-run` (single object, updated over time)

  * title, subtitle, status
  * fileEdits (small list)
  * groupOrder (list of groupIds)
* `data-progress-group` (one per groupId; updated)

  * title, state, itemOrder
* `data-progress-item` (one per itemId; updated)

  * kind: analyzed|edit|terminal|error|note
  * label, filePath, stats, payload
* `data-rlm-state` (your phase/step/progress object, same idea you already have)

**Data parts (transient)**

* `data-toast` (“Compiling…”, “Permission needed…”) — transient parts won’t be persisted into message history. ([AI SDK][4])

Key design choice: **don’t keep resending giant arrays**. Stream a stable `run` object + separately stream/update groups/items by ID.

---

## 4) Streaming guide (AI SDK v6 + Hono) to produce Antigravity-like updates

### 4.1 Use the UIMessage data stream protocol (SSE)

AI SDK data streams are SSE-based, and when implementing a **custom backend**, you should set `x-vercel-ai-ui-message-stream: v1`. ([AI SDK][1])

The protocol supports:

* tool input streaming (`tool-input-start`, `tool-input-delta`, `tool-input-available`)
* tool output (`tool-output-available`)
* step boundaries (`start-step`, `finish-step`)
* message finish (`finish`) and `[DONE]` termination ([AI SDK][1])

### 4.2 Server pattern you want: `createUIMessageStream` + `writer.merge(result.toUIMessageStream())`

This is the cleanest way to:

* write your **Run Card data parts**
* then merge the model’s own stream (text, tools, etc.) into the same response ([AI SDK][4])

High-level flow:

1. `writer.write(data-run init)`
2. `writer.write(data-progress-group init)`
3. while your agent works:

   * update `data-progress-item` as you analyze/edit/run commands
   * update `data-run` summary + files edited
4. start `streamText({ tools, messages, ... })`
5. `writer.merge(result.toUIMessageStream())`
6. onFinish: update metadata + mark run done

### 4.3 Tool calling → UI rendering

If you use AI SDK tool calling, the client can show:

* “Tool call started”
* streaming args
* “Tool output available”
  …purely from stream parts. ([AI SDK][1])

For Antigravity-like “Progress Updates”, you typically also emit **your own progress items** (because “Analyzed X” isn’t always a tool call).

So you do **both**:

* let AI SDK stream tool parts (native)
* you stream `data-progress-item` for the human-friendly timeline

---

## 5) Client guide (Solid + your store/parser) to recreate the layout

### 5.1 Update your parser to match AI SDK v6 part names

From the protocol doc, your current parser should additionally support: ([AI SDK][1])

* `tool-input-available` (you currently treat `tool-input-end`)
* `tool-output-available` (you currently treat `tool-result`)
* `errorText` field name (doc shows `errorText`)
* `inputTextDelta` field name (doc shows `inputTextDelta`)
* `start-step` / `finish-step`
* optionally `reasoning-start/delta/end` (if you choose to show it)

Also: if you’re implementing a custom backend, ensure the header is set (`x-vercel-ai-ui-message-stream: v1`) so your client knows it’s the UIMessage stream. ([AI SDK][1])

### 5.2 Rendering logic (simple + robust)

In your message renderer:

* If a message has a `data-run` part → render `<RunCard/>`
* Inside `<RunCard/>`, subscribe to:

  * `data-run` (title/subtitle/status/files)
  * each `data-progress-group`
  * each `data-progress-item` by `itemOrder`
* For other parts:

  * `text` parts render as normal markdown/text
  * `tool-*` parts render as collapsible “Tool call” rows (optional)
  * `data-rlm-state` drives any extra “phase” UI

### 5.3 “Thought for Xs”

Client-side implementation is easiest:

* record `sendStartedAt`
* on first received stream part (`message-start`, `data-run`, or first `text-delta`) set `firstUpdateAt`
* if `firstUpdateAt - sendStartedAt > threshold`, show `Thought for Ns`

Optionally also display a **streamed “thinking summary”**:

* server emits `data-thinkingSummary` (transient) early
* UI shows it under the Thought header

---

## 6) Notes on your current Solid store/hook (important for Antigravity-level smoothness)

### 6.1 Your “O(1) updates” claim isn’t fully true yet

This selector:

```ts
setStore("messages", m => m.id === messageId, produce(...))
```

still has to **find** the message (typically O(N) scan). With 50–100 deltas/sec, you’ll eventually feel it.

To make it truly O(1):

* store messages in `{ order: string[], byId: Record<string, ChatUIMessage> }`
* render by `order.map(id => byId[id])`
* update by `setStore("byId", messageId, ...)`

This is the single biggest perf win if you want Antigravity-like “very chatty” streams.

### 6.2 Logging will destroy streaming performance

You currently log *per line* in the parser (`logger.info("[PARSER] Processing line"...`) which will absolutely bottleneck at token-rate.

Rule of thumb:

* log only `start`, `finish`, tool boundaries, and errors
* never log per delta in production

---

## 7) Minimal “spec checklist” you can implement in order

1. **Define typed UIMessage** (metadata + data parts). ([AI SDK][2])
2. **Server**: switch `/api/chat` to return a UIMessage stream:

   * simplest: `streamText().toUIMessageStreamResponse()` ([AI SDK][1])
   * best: `createUIMessageStream` + `writer.write` + `writer.merge(result.toUIMessageStream())` ([AI SDK][4])
3. Add custom data parts:

   * `data-run`, `data-progress-group`, `data-progress-item`, `data-rlm-state`
4. **Client**: extend parser to v6 tool/step part names. ([AI SDK][1])
5. Build `<RunCard/>` renderer for those data parts.
6. Add “Thought for Xs” timing + (optional) streamed thinking summary.
7. Optimize store shape to **true O(1)** updates.

---

If you want, paste your **`types/ui-message.ts`** (your `ChatUIMessage` / parts union) and I’ll map it into a **clean “MyUIMessage” typing** that matches AI SDK v6’s expectations, including the exact `data-*` types you need for the Run Card and how to reconcile them by `id`.

[1]: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol "AI SDK UI: Stream Protocols"
[2]: https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message?utm_source=chatgpt.com "AI SDK Core: UIMessage"
[3]: https://ai-sdk.dev/docs/ai-sdk-ui/message-metadata?utm_source=chatgpt.com "AI SDK UI: Message Metadata"
[4]: https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data "AI SDK UI: Streaming Custom Data"
