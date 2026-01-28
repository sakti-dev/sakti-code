Below is what I’d change to make this **(a)** idiomatic Solid, **(b)** maximally compatible with the **current AI SDK UI stream protocol**, and **(c)** robust for tool-calls + long-running “agent state” streaming.

I’m going to be pretty opinionated here: your plan is strong conceptually, but you’re currently re‑implementing parts the AI SDK already standardizes (stream protocol, tool lifecycle parts, custom data streaming). If you align to the AI SDK’s **UIMessage stream protocol**, you get: keep-alives/ping, reconnect hooks, standardized tool streaming, typed message parts, and future compatibility with transports/hook ecosystems. ([AI SDK][1])

---

## The biggest architectural change I recommend

### Don’t stream your own custom SSE events (`event: state`, `event: tool-call-delta`, etc.)

Instead, emit **AI SDK UIMessage stream parts** (SSE `data: {…}` objects with `type: ...`) and send your “XState machine status” as **custom `data-*` parts** (e.g. `data-rlm-state`). This makes your backend output consumable by AI SDK tooling (and by any future AI SDK-compatible UI client). ([AI SDK][1])

Why this matters:

- The AI SDK’s **Data Stream Protocol** is SSE-based and standardizes:
  - message start
  - text start/delta/end
  - tool input start/delta/available
  - tool output available
  - errors
  - steps
  - termination (`[DONE]`)

- If you stick to this, you don’t need to invent your own protocol or parsing rules. ([AI SDK][1])

Also: if you stream from a “custom backend”, the docs note you must set the header `x-vercel-ai-ui-message-stream: v1`. The helper response constructors do this for you. ([AI SDK][1])

---

## Align your message model to AI SDK UI (`UIMessage` + `parts`)

Your snippets use `Message` with `content` and `toolCalls`. AI SDK UI’s current best-practice is: render **`UIMessage.parts`**, because tools, files, sources, data, and streaming all land in parts. ([AI SDK][1])

This is the single biggest “future proofing” change you can make:

- Your UI becomes capable of showing tool calls/results, reasoning blocks, custom progress, files, etc.
- You stop parsing “tool JSON” manually in the UI just to guess state.

---

## Recommended revised architecture (still “hybrid”, but AI SDK-native)

Keep your layers, but make one key substitution: **make your streaming boundary AI SDK-native**.

### Layer 1 — Solid UI

- Solid signals/store for rendering
- components render `message.parts` (text/tool/data)
- tool UI calls `addToolOutput(...)` (client-side tool results)

### Layer 2 — “Chat runtime” (headless client)

- owns connection lifecycle (abort, retries)
- owns parsing the AI SDK UIMessage stream
- emits:
  - `messages[]` updates
  - `status`
  - optionally: extracted `rlmState` from `data-rlm-state`

### Layer 3 — Server “agent endpoint”

- runs XState + calls AI SDK `streamText`
- merges streams into one UIMessage stream:
  - `writer.write({ type: 'data-rlm-state', ... })` for XState snapshots
  - `writer.merge(result.toUIMessageStream())` for model output + tool streaming ([AI SDK][2])

This gives you one stream, one parser, one protocol.

---

## Server-side: how to implement this “correctly” with AI SDK helpers

### Use `createUIMessageStream` + `createUIMessageStreamResponse`, then `merge()`

This pattern is straight out of the “Streaming Custom Data” guide and is _exactly_ what you want for XState snapshots + LLM streaming in one pipe. ([AI SDK][2])

**Pseudo-implementation:**

```ts
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
// import { createActor } from "xstate";
// import { rlmMachine } from "./machine";

type MyUIMessage = UIMessage<
  never,
  {
    "rlm-state": {
      value: unknown;
      // keep this SMALL — don’t dump huge context every tick
      phase?: string;
      step?: string;
      progress?: number;
    };
  }
>;

export async function POST(req: Request) {
  const { messages, goal }: { messages: MyUIMessage[]; goal: string } = await req.json();

  const stream = createUIMessageStream<MyUIMessage>({
    execute: async ({ writer }) => {
      // 1) Start XState actor and stream snapshots as data parts
      // const actor = createActor(rlmMachine, { input: { goal } });
      // actor.start();

      // const sub = actor.subscribe(snapshot => {
      //   writer.write({
      //     type: "data-rlm-state",
      //     id: "rlm",            // stable id => update same data part
      //     transient: true,      // don’t persist into history
      //     data: {
      //       value: snapshot.value,
      //       phase: snapshot.context.phase,
      //       step: snapshot.context.step,
      //       progress: snapshot.context.progress,
      //     },
      //   });
      // });

      // 2) Run model streaming with tools
      const result = streamText({
        model: "anthropic/claude-sonnet-4.5",
        messages: await convertToModelMessages(messages),
        tools: {
          // server tools: include execute()
          // client tools: omit execute()
        },
      });

      // 3) Merge AI output stream into the same UIMessage stream
      writer.merge(result.toUIMessageStream());

      // 4) Cleanup when finished
      // result.finished.finally(() => {
      //   sub.unsubscribe();
      //   actor.stop();
      // });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
```

Key best-practices embedded above:

- Use **`data-*` parts** for XState snapshots. ([AI SDK][1])
- Use a stable `id` to “patch” the same data part repeatedly (so UI can reconcile progress). ([AI SDK][2])
- Mark frequent updates `transient: true` unless you truly want them stored in chat history. ([AI SDK][2])
- Merge the model stream via `writer.merge(result.toUIMessageStream())`. ([AI SDK][2])

### Tool lifecycle: stop inventing states, consume AI SDK tool parts

The stream protocol already gives you granular tool input/output events:

- `tool-input-start`
- `tool-input-delta`
- `tool-input-available`
- `tool-output-available` ([AI SDK][1])

And at the message level, you’ll observe `parts` switching between tool call/result types. ([AI SDK][3])

---

## Client-side: best practice “tool loop” + user-interaction tools

Your ToolCall UI is trying to infer too much from partially valid JSON. AI SDK UI supports a clean approach:

- Server emits tool calls (and server-executed tool results automatically)
- Client can:
  - auto-run certain client tools in `onToolCall`
  - show interactive tools to user
  - return results with `addToolOutput`
  - optionally auto-submit once all results exist (`sendAutomaticallyWhen`) ([AI SDK][4])

Two important best practices from the docs:

- In `onToolCall`, **check `toolCall.dynamic` first** for correct TS narrowing. ([AI SDK][4])
- When calling `addToolOutput`, **don’t `await` it** to avoid deadlocks. ([AI SDK][4])

Even if you’re not using `@ai-sdk/react`, your Solid runtime should support the same semantics.

---

## Your Solid code has a few correctness issues (and how to fix them)

### 1) `createMemo(() => new ChatClient(...), [options.api])` is React thinking

Solid `createMemo` has no dependency array; it tracks reactive reads. Since `options.api` isn’t reactive, the memo won’t help.

**Fix:** instantiate once (or make `api` a signal if you truly need hot swapping).

### 2) You’re calling methods on the memo instead of the value

You do `client.stop()` but `client` is a memo; it should be `client().stop()` if you keep the memo.

### 3) Your store example is not valid Solid store API

`createStore` returns `[state, setState]`. There is no `ChatStore.set(...)` / `ChatStore.getState()` as shown.

**Correct pattern:**

```ts
import { createStore, reconcile } from "solid-js/store";
import type { UIMessage } from "ai";

type ChatState = {
  messages: UIMessage[];
  status: "idle" | "streaming" | "error";
  error: string | null;
};

const [chat, setChat] = createStore<ChatState>({
  messages: [],
  status: "idle",
  error: null,
});

function updateMessages(next: UIMessage[]) {
  setChat("messages", reconcile(next, { key: "id" }));
}
```

### 4) Your component props mix signals and values

Example:

- `Messages` props type says `isLoading: boolean`
- but the component uses `props.isLoading()` as if it were an accessor

**Fix:** decide one style:

- pass values: `isLoading={isLoading()}` and read `props.isLoading`
- or pass accessors: `isLoading={isLoading}` and type it as `Accessor<boolean>`

In Solid, passing accessors is often nicer because it avoids re-wiring effects.

---

## Symbol purification: keep it, but scope it correctly

You’re right that Solid store objects can carry proxies/symbols that you **don’t want crossing the network boundary**.

Best practice: **sanitize only at the boundary** (right before `fetch` / `JSON.stringify`), not on every internal update.

Two good options:

- `structuredClone(obj)` (works well for plain JSONy data)
- `unwrap(storeValue)` from `solid-js/store` (very idiomatic Solid)

Your current “structuredClone everywhere” approach is safe, but it can become expensive. Boundary-only sanitization is usually the sweet spot.

---

## Make your implementation “robust” the AI SDK way

### 1) Use the AI SDK stream protocol end-to-end

- Your backend response should be created by `toUIMessageStreamResponse()` or `createUIMessageStreamResponse()`. ([AI SDK][1])
- Your client should parse as “UIMessage stream parts” (not custom event names).

### 2) Don’t model tool lifecycle twice

If XState is your orchestrator, treat “tool status” as _derived UI state_, not an independent state machine unless you truly need it.

- “Input streaming” = you’re receiving `tool-input-delta` ([AI SDK][1])
- “Ready to execute” = `tool-input-available` ([AI SDK][1])
- “Complete” = `tool-output-available` or tool-result part observed ([AI SDK][1])

### 3) Stream XState snapshots as `data-*` parts (not separate SSE)

This gives you:

- standardized merging
- `transient` updates
- consistent client parsing ([AI SDK][2])

---

## About resumable streams vs abort/stop

Your plan includes a Stop button (abort). AI SDK’s resumable streams feature is explicitly **not compatible with abort** as a simple toggle; the docs warn not to use `resume: true` if you need abort functionality. ([AI SDK][5])

So pick one:

- If “Stop generation” is critical: **don’t implement resume yet**
- If resuming is critical: you’ll need a more advanced cancellation mechanism (server-side cancel semantics) rather than relying on “disconnect abort”.

(You can still implement reconnection later; just don’t design yourself into a corner.)

---

## Concrete “upgrade checklist” for your plan

### Phase 0 (new): protocol + types

- ✅ Switch from `Message`+`content` to **`UIMessage` + `parts` rendering** ([AI SDK][1])
- ✅ Make the server stream AI SDK protocol parts (don’t invent SSE events) ([AI SDK][1])

### Phase 1: Headless client

- Implement a headless runtime that:
  - `sendMessage({ text })`
  - reads the **UIMessage stream**
  - updates `messages[]` and `status`
  - supports `addToolOutput({ toolCallId, output })` semantics

- Prefer using AI SDK helpers where possible (e.g., conceptually mirroring the transport model). ([AI SDK][6])

### Phase 2: Server (XState + model streaming)

- Implement `createUIMessageStream()`:
  - `writer.write({ type: "data-rlm-state", ... })` for XState snapshots
  - `writer.merge(result.toUIMessageStream())` for model/tool streaming ([AI SDK][2])

### Phase 3: Solid hook

- Fix Solid primitives usage (no dependency arrays, correct memo calls)
- Decide store vs signals (don’t maintain two sources of truth)

### Phase 4: Components

- Update `<Messages>` to render `message.parts`
- Update tool UI to render tool parts (call/result) rather than parsing raw args strings
- Add a tiny “data part renderer” for `data-rlm-state` (progress UI)

[1]: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol "AI SDK UI: Stream Protocols"
[2]: https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data "AI SDK UI: Streaming Custom Data"
[3]: https://ai-sdk.dev/docs/ai-sdk-ui/reading-ui-message-streams "AI SDK UI: Reading UIMessage Streams"
[4]: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage "AI SDK UI: Chatbot Tool Usage"
[5]: https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams "AI SDK UI: Chatbot Resume Streams"
[6]: https://ai-sdk.dev/docs/ai-sdk-ui/transport "AI SDK UI: Transport"
