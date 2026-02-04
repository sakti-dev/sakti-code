Yep — what you’re seeing is basically **two different renderers over the same “agent events” stream**:

* **Planning mode** ⇒ the UI **aggregates events into one “Run Card”** (title + files edited + progress updates) and keeps updating that *single* card as new events arrive.
* **Build mode** ⇒ the UI shows a **chronological activity feed** (terminal blocks, analyzed files, edits, errors, “Thought for Ns”), and the assistant’s final answer is just a normal message at the bottom. No big container card.

To recreate that, you don’t need a different backend protocol — you need **mode-aware message metadata + two UI compositions**.

---

## 1) Mode contract: how the UI decides “Run Card” vs “Activity Feed”

### Client → server

Send a mode on every `/api/chat` request:

```ts
type AgentMode = "planning" | "build";

body: {
  message: string;
  mode: AgentMode;
  // optionally:
  runId?: string; // persisted during a multi-step run
}
```

### Server → client

Attach `mode` on the **assistant message metadata** and stream **data parts** that are mode-specific:

* **Planning mode streams**

  * `data-run` (single evolving object)
  * `data-progress-group` / `data-progress-item`
  * `data-files-edited`
* **Build mode streams**

  * `data-action` (append-only or updatable per id)
  * `data-terminal` (or just `data-action` kind="terminal")
  * optional `data-thought`

The UI checks message metadata:

```ts
if (msg.metadata?.mode === "planning") renderRunCard(msg);
else renderBuildFeed(msg);
```

---

## 2) What “Build mode” layout actually is (from your screenshot)

Build mode looks like:

1. **(Optional) Thought marker**

   * `Thought for 4s`

2. **Terminal block card**

   * command + output
   * footer: “Ran background terminal command / Open Terminal / Exit code …”

3. **Action rows**

   * “Checked command status”
   * “Analyzed message-list.tsx#L85-105”
   * “Edited message-list.tsx +4 -3 (Open diff)”
   * “Error while editing …”

4. **Final assistant message content**

   * “Verification: pnpm typecheck … pnpm lint …”

So: **Build mode = Activity Feed + Final Answer**.

Planning mode in your earlier screenshots is **Run Card only** (plus small summary text), where those same events are *grouped*.

---

## 3) Data model spec (use ONE event stream, render two ways)

### 3.1 Canonical “event” shape

Use one event schema everywhere:

```ts
type AgentEventKind =
  | "thought"
  | "note"
  | "analyzed"
  | "edited"
  | "created"
  | "deleted"
  | "terminal"
  | "error";

type AgentEvent = {
  id: string;              // stable id for updates
  kind: AgentEventKind;
  ts: number;              // epoch ms
  title: string;           // one-line label
  subtitle?: string;       // optional
  file?: { path: string; range?: string }; // e.g. "#L85-105"
  diff?: { plus: number; minus: number };
  terminal?: {
    cwd?: string;
    command: string;
    outputPreview: string; // last N lines
    exitCode?: number;
    background?: boolean;
  };
  error?: { message: string; details?: string };
  actions?: Array<
    | { type: "open-file"; path: string }
    | { type: "open-diff"; path: string }
    | { type: "open-terminal"; commandId: string }
  >;
};
```

### 3.2 Planning mode = aggregated view

Planning mode **does not need different “events”** — it needs an *aggregator model*:

```ts
type PlanningRun = {
  runId: string;
  title: string;
  subtitle?: string;
  status: "planning" | "running" | "done" | "error";
  filesEdited: Array<{ path: string; plus?: number; minus?: number; action?: "open-diff" }>;
  groups: Array<{
    groupId: string;
    title: string;
    eventIds: string[]; // references events
    collapsed?: boolean;
  }>;
};
```

So internally you can store **events** and then:

* Planning mode UI renders a **Run Card** (grouped)
* Build mode UI renders a **flat feed** (chronological)

This is how you keep your backend simple.

---

## 4) Streaming spec: how to emit Build-mode feed vs Planning-mode card

You’re already parsing `data-*` parts. Great. The only change is **which parts you emit**.

### 4.1 Build mode streaming (activity feed)

Emit one `data-action` per event (id stable). The UI renders them in the “Recent actions” section.

* For terminal:

  * emit `data-action` with `kind="terminal"` and include outputPreview
  * update it as more output arrives (same id)

* For “Thought for Ns”:

  * easiest: client computes from gaps (recommended)
  * optional: server emits `data-action kind="thought"`

### 4.2 Planning mode streaming (run card)

Emit:

* `data-run` (single id, updated as title/subtitle/files/groups change)
* `data-progress-item` (events) OR reuse `data-action` and reference ids from groups

**Rule of thumb**

* Build mode: “show everything as it happens”
* Planning mode: “summarize + group + keep it compact”

---

## 5) “Thought for Ns” — how to recreate it exactly

In your build-mode screenshot, you get multiple “Thought for …” lines between actions. That’s almost certainly computed from **time gaps between “significant events”**, not token deltas.

### Recommended client algorithm

Maintain `lastEventAt` for each running assistant response:

* Consider these as “significant events”:

  * any `data-action` / `data-run` update
  * tool start/end/result
  * terminal output update
  * (not text-delta)

When a new significant event arrives:

* `gapMs = now - lastEventAt`
* if `gapMs >= 900ms` → insert a synthetic event:

```ts
{ kind: "thought", title: `Thought for ${Math.round(gapMs/1000)}s`, ts: now }
```

Planning mode can display the same marker either:

* above the Run Card, or
* as a progress item inside the current group

---

## 6) Concrete UI composition differences (what you actually build in Solid)

### Build mode component tree

```
<MessageBubble>
  <ActionFeed>              // “Recent actions” list (streamed)
    <ThoughtRow/>
    <TerminalCard/>
    <ActionRow/>
    <ActionRow/>
  </ActionFeed>

  <MarkdownMessageBody/>     // final assistant text
</MessageBubble>
```

### Planning mode component tree

```
<MessageBubble>
  <RunCard>                  // one big container (streamed)
    <Header/>
    <FilesEditedList/>
    <ProgressGroups/>
  </RunCard>

  <OptionalSummaryText/>     // sometimes present
</MessageBubble>
```

---

## 7) Small but important note for your current implementation

Your store is great for “update a message by id”, but right now updates still require scanning `messages` to find `m.id === messageId`. For **build-mode feeds** (lots of events), you’ll feel it.

If you want Antigravity-level smoothness:

* store messages as `{ order: string[]; byId: Record<string, ChatUIMessage> }`
* store events similarly `{ order: string[]; byId: Record<string, AgentEvent> }`

That makes “append/update event” truly O(1).

---

If you paste your current `types/ui-message.ts` (the `ChatUIMessage` parts union), I can write an exact typed extension for:

* `data-action` / `data-run`
* the two Solid renderers (RunCard vs ActionFeed)
* and how to route tool-call/tool-result into your feed rows without duplicating UI.
