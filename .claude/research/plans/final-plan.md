Below is a **single cohesive spec** you can hand to yourself (or teammates) to implement **Antigravity-style “Planning Run Card”** vs **“Build/Chat Activity Feed”** in **Electron + SolidJS + Tailwind**, backed by **Vercel AI SDK v6 UIMessage streaming**.

---

# Spec: Dual-Mode Agent Chat UI (Planning Run Card + Build Activity Feed)

## 0) Goals

### What you are recreating

You’re recreating *two* distinct assistant presentation modes over the *same underlying agent events*:

1. **Planning mode (aggregated)**
   A **single big block** (Run Card) that continuously updates:

   * Title (e.g. “Planning Desktop-Agent Integration”)
   * “Files Edited”
   * “Progress Updates” grouped into numbered sections
   * Occasional “Thought for Ns” separators (UI-only)

2. **Build/Chat mode (chronological feed)**
   No big block. Instead:

   * “Thought for Ns” separators
   * Terminal output cards
   * “Analyzed / Edited / Error …” rows
   * Final assistant message content (normal markdown)

### Core principle

**Same backend stream protocol**, different **UI composition rules** based on message metadata (`mode`) + data parts.

---

## 1) Protocol & Architecture

### 1.1 Use AI SDK “UIMessage stream” (SSE)

Your server must stream responses using the AI SDK UI message stream protocol (SSE with JSON parts) and terminate with `[DONE]`. ([AI SDK][1])

### 1.2 Message-level metadata decides the renderer

Use message metadata to declare which layout to render. Metadata is explicitly intended for message-level info separate from message content. ([AI SDK][2])

**Required metadata fields**

* `mode: "planning" | "build"`
* `runId: string` (stable per run / message)
* `startedAt: number` (epoch ms)
* `firstSignificantUpdateAt?: number`
* `finishedAt?: number`
* `status: "running" | "done" | "error" | "aborted"`
* `model?: string`
* `usage?: { inputTokens: number; outputTokens: number; totalTokens: number }` (optional)

### 1.3 Stream “custom data parts” for UI blocks

AI SDK supports attaching additional data alongside model output by streaming **data parts** that become entries in `UIMessage.parts[]`. ([AI SDK][3])

You’ll use `data-*` parts for:

* Run Card state (planning)
* Activity feed rows (build)
* Terminal output blocks
* RLM/phase state (`data-rlm-state`), etc.

---

## 2) Canonical “Agent Event” Model (shared across modes)

Even if you stream different `data-*` part types per mode, internally you should normalize everything into one event model:

```ts
type AgentMode = "planning" | "build";

type AgentEventKind =
  | "thought"
  | "note"
  | "analyzed"
  | "created"
  | "edited"
  | "deleted"
  | "terminal"
  | "error"
  | "tool";

type AgentEvent = {
  id: string;          // stable; allow updates
  ts: number;          // epoch ms
  kind: AgentEventKind;

  title: string;       // one-line label
  subtitle?: string;   // optional second line

  file?: { path: string; range?: string }; // e.g. message-list.tsx#L85-105
  diff?: { plus: number; minus: number };

  terminal?: {
    command: string;
    cwd?: string;
    outputPreview: string; // last N lines
    exitCode?: number;
    background?: boolean;
  };

  error?: { message: string; details?: string };

  actions?: Array<
    | { type: "open-file"; path: string }
    | { type: "open-diff"; path: string }
    | { type: "open-terminal"; id: string }
  >;
};
```

**Rendering rule**

* **Build mode** shows events as a flat feed (chronological).
* **Planning mode** groups these events into a Run Card structure.

---

## 3) Planning Mode: Run Card Data Model

Planning mode is “aggregated UI”. Don’t stream 200 small rows unless you need to—stream a *compact evolving state* plus item details.

### 3.1 Data parts (recommended)

* `data-run` (single object, updated over time)
* `data-run-file` (optional per-file parts, stable ids)
* `data-run-group` (per progress group)
* `data-run-item` (per progress item)
* `data-rlm-state` (your phase/step/progress)

**Update semantics**

* Use stable `id` so a later stream chunk **replaces** the earlier part with same `type`+`id` (that’s how you keep the card “live”). (AI SDK behavior; also highlighted in AI SDK blogs/examples.) ([Vercel][4])

### 3.2 Structures

**data-run** (`id = runId`)

* `title: string`
* `subtitle?: string`
* `status: "planning" | "executing" | "done" | "error"`
* `filesEditedOrder: string[]` (ids)
* `groupsOrder: string[]` (ids)
* `collapsedAll?: boolean`

**data-run-file** (`id = fileId`)

* `path: string`
* `tag?: "Task" | "Implementation Plan" | "Doc" | "Code"`
* `diff?: { plus: number; minus: number }`
* `cta?: "open" | "open-diff"`

**data-run-group** (`id = groupId`)

* `index: number` (1-based)
* `title: string`
* `collapsed: boolean`
* `itemsOrder: string[]`

**data-run-item** (`id = itemId`)

* `kind: AgentEventKind`
* `title: string`
* `meta?: string` (e.g. “#L85-105”, “Exit code 1”)
* `file?: { path; range? }`
* `diff?: { plus; minus }`
* `terminal?: { ... }`
* `error?: { ... }`

---

## 4) Build Mode: Activity Feed Data Model

Build mode is “chronological UI”. Stream discrete feed items.

### 4.1 Data parts

* `data-action` (one per feed row; stable id)
* `data-terminal` (optional; but you can also represent as `data-action kind="terminal"`)
* `data-thought` (optional—recommended to compute client-side)
* tool parts from AI SDK (if you expose tool calls/results)

### 4.2 Build mode rendering rules

* Every time you receive a `data-action`/terminal/tool boundary, append (or update) an item in the feed list.
* The assistant’s final “answer” is just normal message text/markdown below the feed.

---

## 5) “Thought for Ns” (UI-only)

This is *not* model chain-of-thought. It’s a timing affordance.

### 5.1 Recommended: client-computed

Maintain `lastSignificantEventAt`. “Significant events” are:

* any `data-run` / `data-action` update
* tool start/end/result
* terminal output update
* error

If gap ≥ **900ms**, insert a synthetic feed row:

* Title: `Thought for ${roundSeconds}s`
* No file/diff metadata

This produces the repeated “Thought for 2s / 8s / 14s” style separators you showed.

---

# 6) UI Spec: Layout, Components, Styling (Tailwind-ready)

The styling below is a **tokenized system** that matches the “Antigravity dark glassy card” feel: subtle borders, deep background, muted text, compact density.

## 6.1 Design tokens (CSS variables)

Define these once (e.g. `:root` in your app):

```css
:root {
  --bg: 26 27 38;              /* app background */
  --surface: 30 31 41;         /* card surface */
  --surface-2: 38 40 52;       /* nested/hover surface */
  --border: 255 255 255;       /* used with low alpha */
  --text: 230 232 242;
  --muted: 160 166 186;
  --faint: 120 126 148;
  --accent: 90 170 255;        /* links, highlights */
  --ok: 74 222 128;
  --warn: 251 191 36;
  --err: 248 113 113;
}
```

Tailwind usage example:

* `bg-[rgb(var(--surface))]`
* `border-white/10`
* `text-[rgb(var(--text))]`

## 6.2 Typography scale

* **H1 / Run title**: 18px, semibold, tracking-tight
* **Section title** (“Files Edited”, “Progress Updates”): 12px, semibold, muted
* **Row title** (“Analyzed …”): 13px, medium
* **Secondary meta**: 12px, normal, faint
* **Code/terminal**: 12px mono, leading-5

Recommended Tailwind:

* Title: `text-[18px] font-semibold tracking-tight`
* Row: `text-[13px] font-medium`
* Meta: `text-[12px] text-white/50`
* Mono: `font-mono text-[12px] leading-5`

## 6.3 Spacing & radius

* Base unit: **4px**
* Typical gaps:

  * between rows: **8px** (`gap-2`)
  * between sections: **12px** (`gap-3`)
  * outer card padding: **16px** (`p-4`)
* Border radius:

  * primary cards: **12px** (`rounded-xl`)
  * nested cards (terminal blocks): **10px** (`rounded-lg`)
  * chips/buttons: **999px** (`rounded-full`)

## 6.4 Borders & shadows (dark UI)

* Card border: `border border-white/10`
* Hover border: `border-white/15`
* Subtle shadow: `shadow-[0_0_0_1px_rgba(255,255,255,0.04)]` or `shadow-sm` (very light)

Background layering:

* App background: `bg-[rgb(var(--bg))]`
* Main card: `bg-[rgba(var(--surface),0.92)]` (or solid surface)
* Hover row: `bg-white/5`

---

# 7) Component Specs (with exact styling + behavior)

## 7.1 Message Bubble (assistant)

**Container**

* `max-w-[820px]` centered
* `px-4` outer gutter
* For assistant: align left; for user: align right (optional)

**Assistant bubble**

* In planning mode: bubble is basically the Run Card (no extra bubble)
* In build mode: bubble contains feed + markdown

---

## 7.2 Planning Mode: Run Card

### 7.2.1 RunCard wrapper

**Layout**

* vertical stack: header → files section → progress section
* `gap-4`

**Tailwind**

```txt
rounded-xl border border-white/10
bg-[rgba(var(--surface),0.92)]
p-4
shadow-[0_0_0_1px_rgba(255,255,255,0.04)]
```

### 7.2.2 Header

**Left**

* Title line (18px)
* Subtitle (13px muted) max 2 lines, ellipsis fade

**Right**

* Status chip + optional elapsed time
* Optional “Collapse all” button appears in Progress section header

**Tailwind**

* Title: `text-[18px] font-semibold text-white/90`
* Subtitle: `text-[13px] text-white/60 leading-5`

### 7.2.3 Status Chip

Variants:

* planning/executing: blue tint
* done: green tint
* error: red tint

**Chip styling**

* `inline-flex items-center gap-1`
* `px-2 py-0.5 rounded-full text-[12px]`
* `bg-white/6 border border-white/10`

Color examples:

* planning: text `text-[rgb(var(--accent))]`
* done: `text-[rgb(var(--ok))]`
* error: `text-[rgb(var(--err))]`

Icon:

* planning: `LoaderCircle` (spinning)
* done: `CheckCircle`
* error: `XCircle`

Icon size:

* 14px (`w-3.5 h-3.5`), stroke 1.8–2.0

---

## 7.3 Files Edited section

### 7.3.1 Section header

* Label left: “Files Edited”
* Optional count right

`text-[12px] font-semibold text-white/60`

### 7.3.2 File row

Row layout:

* left icon (file/doc/task)
* path (mono-ish)
* tag pill (optional)
* diff stats (optional)
* right action (“Open diff”, “View”, “Open”)

Row container:

* `h-9` (compact)
* `px-2`
* hover background `bg-white/5`

Tailwind:

```txt
flex items-center justify-between
rounded-lg
px-2 py-2
hover:bg-white/5
transition-colors
```

Path:

* `font-mono text-[12px] text-white/75`

Diff stats:

* plus green `text-[rgb(var(--ok))]`
* minus red `text-[rgb(var(--err))]`
* use `text-[12px] tabular-nums`

---

## 7.4 Progress Updates section (groups)

### 7.4.1 Section header row

Left: “Progress Updates”
Right: “Collapse all” button

Button styling:

* `text-[12px] text-white/50 hover:text-white/70`
* no border, minimal

### 7.4.2 Group header row

Layout:

* number badge (small)
* group title
* chevron right

Group header style:

* `py-2`
* `text-[13px] font-semibold text-white/80`
* hover: `bg-white/4`

Number badge:

* `w-5 h-5 rounded-md`
* `bg-white/6 border border-white/10`
* `text-[12px] text-white/60`
* centered

Chevron:

* `w-4 h-4 text-white/40`
* rotates 90° when expanded

### 7.4.3 Group body

Indented list:

* left padding `pl-7` (to align under title after badge)
* each item row `py-1.5` with `gap-2`

---

## 7.5 Progress Item Row (Analyzed / Edited / Terminal / Error)

All rows share:

* icon (left)
* label + optional meta
* optional action on right (open diff/open file)
* compact height 28–32px

### 7.5.1 Row base

```txt
flex items-start gap-2
rounded-lg
px-2 py-1.5
hover:bg-white/5
```

### 7.5.2 Icon rules

* 14px (`w-3.5 h-3.5`)
* Muted by default: `text-white/45`
* Type tint:

  * analyzed: muted
  * edited/created: `text-[rgb(var(--accent))]` or white/60
  * terminal: `text-white/55`
  * error: `text-[rgb(var(--err))]`

Suggested icons (lucide):

* analyzed: `Search`
* edited: `Pencil`
* created: `Plus`
* terminal: `Terminal`
* error: `XCircle`
* thought: `Brain` (or just plain text, no icon)

### 7.5.3 Label/meta typography

* Label: `text-[13px] text-white/75`
* Meta (line ranges / exit codes): `text-[12px] text-white/45`

---

## 7.6 Terminal Card (Build mode + sometimes inside Planning items)

Terminal blocks are visually distinct, like your screenshot.

### 7.6.1 Container

```txt
rounded-xl border border-white/10
bg-[rgba(var(--surface),0.88)]
p-3
```

### 7.6.2 Command line

* Mono
* slightly brighter than output
  `font-mono text-[12px] text-white/75`

### 7.6.3 Output area

* Monospace
* `max-h-[280px]` with scroll
* background darker inset

```txt
mt-2 rounded-lg
bg-black/25
border border-white/5
p-2
font-mono text-[12px] leading-5
text-white/65
overflow-auto
```

### 7.6.4 Footer row

* “Ran terminal command”, “Open Terminal”, “Exit code X”, “Always Proceed”
* Small text `text-[12px] text-white/45`
* Links in accent `text-[rgb(var(--accent))] hover:underline`

Exit code color:

* 0: green
* non-zero: red

---

## 7.7 Build Mode: Activity Feed

### 7.7.1 Feed container

Placed above markdown assistant response:

* `mt-2` spacing
* `space-y-2`

Each feed row uses the same Row base as progress items (but ungrouped).

### 7.7.2 “Thought for Ns”

Render as a minimal separator row:

* no hover
* `text-[12px] text-white/40`
* `mt-2 mb-1`
* left aligned with feed icon column (or slightly inset)

Optional caret to collapse/expand the following block (nice-to-have).

---

# 8) Backend: Streaming Implementation Requirements

## 8.1 Return a UIMessage stream response

On the backend, AI SDK provides helpers to stream UI messages. `streamText(...).toUIMessageStreamResponse()` returns a streaming HTTP response compatible with the UI message stream protocol. ([AI SDK][1])

## 8.2 Streaming custom `data-*` parts

Use AI SDK UI streaming-data helpers to attach custom data parts alongside the model stream. ([AI SDK][3])

## 8.3 For advanced merging (optional but recommended)

Use `createUIMessageStream` / `createUIMessageStreamResponse` when you want to:

* emit your own parts (run/actions) before model text
* merge multiple streams
* attach finish callbacks and headers
  ([AI SDK][5])

---

# 9) Frontend: Solid Store + Rendering Requirements

## 9.1 Store shape (performance-critical)

To achieve true “Antigravity smoothness” at high token/event rates:

**DO NOT** store messages as a single array if you frequently update by id.

Use:

* `messagesOrder: string[]`
* `messagesById: Record<string, ChatUIMessage>`
* `eventsOrder: string[]`
* `eventsById: Record<string, AgentEvent>`

Updates become O(1) (`setStore("messagesById", id, ...)`) instead of scanning arrays.

## 9.2 Parser requirements (AI SDK stream protocol)

Your parser must support:

* `[DONE]` termination ([AI SDK][1])
* message-level chunks (start/finish)
* tool boundaries + tool output events (if you display them)
* `data-*` parts (stable ids replace earlier parts)

(Use `data-*` parts for your UI; keep text-delta logging OFF in production.)

---

# 10) Final Rendering Rules (the “decision matrix”)

For each **assistant message**:

1. Read `message.metadata.mode`
2. If `"planning"`:

   * render `RunCard` using `data-run` + group/item parts
   * optionally render small markdown summary *below* card
3. If `"build"`:

   * render `ActivityFeed` from `data-action` (and terminal/tool parts)
   * render markdown message body below

**Important**

* Planning mode should minimize noise by grouping & compressing.
* Build mode should maximize visibility & timeline fidelity.

---

# 11) Deliverables Checklist (what you implement)

### Must-have

* [ ] `mode` metadata wired end-to-end (client → server → message)
* [ ] Run Card renderer for planning mode
* [ ] Activity Feed renderer for build mode
* [ ] `data-run` + `data-action` streaming
* [ ] Terminal card component
* [ ] “Thought for Ns” gap detector (client)

### Should-have

* [ ] stable IDs so updates replace instead of append
* [ ] collapsible progress groups + collapse-all
* [ ] file actions: open file, open diff, open terminal
* [ ] error rows with expandable details

### Nice-to-have

* [ ] per-group progress percent
* [ ] search/filter actions in build feed
* [ ] sticky footer “status bar” (streaming / done / error)

---

If you want, paste your current `types/ui-message.ts` (the union for `parts`) and I’ll:

* produce the **exact `data-run` / `data-action` part typings**,
* show how to wire them into your existing `updateDataPart()` pattern (stable ids),
* and give you **Tailwind class bundles per component** ready to copy into Solid components.

[1]: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol?utm_source=chatgpt.com "AI SDK UI: Stream Protocols - Vercel"
[2]: https://ai-sdk.dev/docs/ai-sdk-ui/message-metadata?utm_source=chatgpt.com "AI SDK UI: Message Metadata"
[3]: https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data?utm_source=chatgpt.com "AI SDK UI: Streaming Custom Data - Vercel"
[4]: https://vercel.com/blog/ai-sdk-5?utm_source=chatgpt.com "AI SDK 5 - Vercel"
[5]: https://v5.ai-sdk.dev/docs/reference/ai-sdk-ui/create-ui-message-stream?utm_source=chatgpt.com "AI SDK UI: createUIMessageStream - v5.ai-sdk.dev"
