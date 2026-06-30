# Design: `websearch` tool

**Date:** 2026-07-01
**Status:** Approved
**Scope:** Add a pluggable web-search tool to `@sakti-code/tools`, with three provider adapters (Exa, Tavily, DuckDuckGo) and server-side provider/key resolution following sakti conventions.

## Goal

Give sakti agents a read-only tool that runs a web search and returns a unified list of results. Provider-agnostic core; provider choice (Exa / Tavily / DuckDuckGo) resolved at server start from `settings.json` (provider) + `auth.json` (key). DuckDuckGo is the zero-config fallback.

## Non-goals

- Replacing the provider-hosted search tools some models expose (those execute at the model provider). This is a local tool backed by external search APIs.
- Live result crawling/content extraction as a first-class output. Snippets only; agents can follow up with `webfetch` for full content.
- Caching, rate-limit backoff, or result ranking beyond what each backend returns natively.
- A settings UI for picking the provider / entering the key in this change (config is file-based; UI is a follow-up).

## Decisions (from brainstorming)

| Decision           | Choice                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------- |
| Architecture       | Pluggable — `SearchOperations` DI seam; three standalone adapter builders                 |
| Backends           | Exa (MCP JSON-RPC), Tavily (REST), DuckDuckGo (HTML scrape)                               |
| Key storage        | `auth.json`, namespaced `websearch:<provider>`; loosen `AuthStore.set/delete` validation  |
| Provider selection | `settings.json` `{ "websearch": { "provider": "exa" \| "tavily" } }`; absent → DuckDuckGo |
| Tool surface       | Minimal common: `{ query, numResults? }` → `SearchResult[]`                               |
| Permission default | `websearch` permission, allow-by-default across build/general/intake/explore/plan         |
| HTTP client        | Node global `fetch` (built-in Node 18+ / Electron)                                        |
| HTML parsing (DDG) | `htmlparser2` (already a `webfetch` dep)                                                  |

## Components

- `packages/tools/src/websearch/index.ts` — tool factory, schema, `SearchOperations` / `SearchResult` types.
- `packages/tools/src/websearch/adapters/exa.ts` — `buildExaOperations(apiKey)`.
- `packages/tools/src/websearch/adapters/tavily.ts` — `buildTavilyOperations(apiKey)`.
- `packages/tools/src/websearch/adapters/ddg.ts` — `buildDdgOperations()`.
- `packages/tools/src/websearch/__tests__/index.test.ts` — tool tests via fake operations (no network).
- One smoke test per adapter (mocked `fetch`, assert request shape + response mapping).
- `apps/server/src/agent/config/websearch-resolver.ts` — the **only** module that imports the three builders + reads auth/settings → returns a `SearchOperations`.
- `apps/server/src/agent/config/tool-registry.ts` — `websearch` factory entry.
- `apps/server/src/agent/config/server-agents.ts` — `activeToolNames` + ruleset entries.
- `apps/server/src/lib/auth-store.ts` — loosen `set()` / `delete()` validation for the `websearch:` prefix.

## Coupling model

The tool knows **only** the `SearchOperations` interface. Adapters know **only** the interface. The resolver is the single coupling point:

```
tool ──► SearchOperations ◄── adapters (exa/tavily/ddg)  ◄── resolver (imports all builders)
   ▲                                                        │
   └──────────────── operations injected via ToolContext ◄──┘
```

Adding a provider (e.g. Brave) = one new `adapters/brave.ts` builder + one line in the resolver. Tool and other adapters are untouched.

## Schema (TypeBox)

```
query:       string          // required, non-empty
numResults:  optional number, 1..20, default 8
```

`WebSearchToolDetails = { provider: string; query: string; count: number; truncation?: TruncationResult }`

## Operations seam

```ts
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOperations {
  search(
    query: string,
    opts: { numResults: number; signal: AbortSignal },
  ): Promise<{ provider: string; results: SearchResult[] }>;
}
```

Each adapter builder returns a `SearchOperations`:

```ts
// adapters/exa.ts
export function buildExaOperations(apiKey: string): SearchOperations;
// adapters/tavily.ts
export function buildTavilyOperations(apiKey: string): SearchOperations;
// adapters/ddg.ts
export function buildDdgOperations(): SearchOperations; // no key
```

`operations.search` owns the HTTP call, auth header, response parsing, and provider-specific field mapping → unified `SearchResult[]`. It honors the passed `AbortSignal` (cooperative cancellation + timeout owned by the caller).

Tests inject a fake `SearchOperations` returning canned results.

## Constants

```
DEFAULT_NUM_RESULTS  = 8
MAX_NUM_RESULTS      = 20
DEFAULT_TIMEOUT_SECONDS = 25
MAX_RESPONSE_BYTES   = 256 * 1024   // per-backend response cap (Exa/Parallel parity)
NO_RESULTS_NOTICE    = "No search results found. Try a different query."
EXA_MCP_URL          = "https://mcp.exa.ai/mcp"
TAVILY_URL           = "https://api.tavily.com/search"
DDG_URL              = "https://lite.duckduckgo.com/lite/"
BROWSER_USER_AGENT   = (shared with webfetch)
```

## Behavior

1. **Validate input**: `query` must be a non-empty trimmed string. `numResults` clamp: `?? DEFAULT_NUM_RESULTS`; `< 1 → 1`; `> MAX_NUM_RESULTS → MAX_NUM_RESULTS`.
2. **Abort/timeout**: build an `AbortController`; wire the external `signal` (abort → reject `Operation aborted`); `setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_SECONDS * 1000)`. On abort during the call → `Web search timed out`.
3. **Search**: `const { provider, results } = await operations.search(query, { numResults, signal: controller.signal })`.
4. **Empty**: if `results.length === 0`, return text `NO_RESULTS_NOTICE` with `details.count = 0`.
5. **Render**: numbered list — `${i}. ${title}\n   ${url}\n   ${snippet}` joined by `\n\n`.
6. **Truncate** rendered text with `truncateHead()`; if truncated, append notice and set `details.truncation`.
7. **Return** `{ content: [{ type: "text", text }], details: { provider, query, count, truncation? } }`.
8. **Cleanup**: `clearTimeout` + remove external-abort listener (in `finally`).

## Adapters

### Exa (`adapters/exa.ts`)

Faithful port of opencode's request/response shape, adapted to plain `fetch`:

- POST `EXA_MCP_URL` (`?exaApiKey=<key>` query param when key present).
- JSON-RPC `tools/call` body: `{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_search_exa", arguments: { query, type: "auto", numResults, livecrawl: "fallback" } } }`.
- Headers: `Accept: application/json, text/event-stream`.
- Cap response at `MAX_RESPONSE_BYTES` (reuse `collectBoundedBody` from webfetch).
- Parse: try direct JSON `{ result: { content: [{ type, text }] } }` → first `text`; else scan `data: <json>` SSE lines for the same shape (port of opencode `parseResponse`).
- Map the returned text as a single `SearchResult { title: "<Exa>", url: "", snippet: <text> }` when Exa returns a context blob, **or** parse a JSON array of `{ title, url, text }` entries into `{ title, url, snippet }` when Exa returns structured results. (Exa's MCP returns markdown context by default; structured mapping is best-effort.)
- 25s timeout via the shared `AbortSignal`.

### Tavily (`adapters/tavily.ts`)

- POST `TAVILY_URL` with `Authorization: Bearer <key>`, `Content-Type: application/json`.
- Body: `{ query, max_results: numResults, include_answer: false }`.
- Cap response at `MAX_RESPONSE_BYTES`.
- Parse `{ results: [{ title, url, content }] }` → `{ title, url, snippet: content }`.

### DuckDuckGo (`adapters/ddg.ts`)

- GET `DDG_URL?q=<query>` (Lite HTML — stable, minimal, no JS).
- Parse with `htmlparser2`: collect result-block anchors `href` + following snippet text. DuckDuckGo Lite renders results as `<a class="result-link" href="...">title</a>` followed by `<td class="result-snippet">snippet</td>`.
- Map to `{ title, url, snippet }`, dedupe by URL, cap at `numResults`.
- No key, no auth header. Best-effort: if parsing yields nothing, return `[]` (tool renders `NO_RESULTS_NOTICE`).

## Config & auth wiring

### Auth store loosening (`apps/server/src/lib/auth-store.ts`)

`getApiKey(provider)` already accepts any string. Only `set()` and `delete()` validate against `KNOWN_PROVIDERS`. Loosen to also accept the `websearch:` namespace prefix:

```ts
const isAllowedKey = (provider: string): boolean =>
  KNOWN_PROVIDERS.includes(provider) || provider.startsWith("websearch:");
```

Use in `set()` and `delete()` guards. `list()` is unchanged — it still iterates only `KNOWN_PROVIDERS` (the LLM connect UI), so namespaced service keys stay out of the models list. `getApiKey("websearch:exa")` returns the stored value.

### Settings provider selection

`settings.json` gains an optional `websearch` section:

```json
{ "websearch": { "provider": "exa" } }
```

Read via the existing `SettingsFileStore.read()`.

### Resolver (`websearch-resolver.ts`)

```ts
export function resolveWebSearchOperations(
  auth: AuthStore,
  settings: SettingsFileStore,
): SearchOperations;
```

Logic:

1. `const cfg = settings.read().websearch` (if not a plain object, treat as absent).
2. `const provider = cfg?.provider`.
3. If `provider === "exa"`: `const key = auth.getApiKey("websearch:exa")`; if `key` → `buildExaOperations(key)`, else `buildDdgOperations()`.
4. If `provider === "tavily"`: same with `websearch:tavily` → `buildTavilyOperations` / fallback DDG.
5. Anything else (absent/unknown) → `buildDdgOperations()`.

This is the only module importing the three builders.

### ToolContext extension

`ToolContext` gains one optional field:

```ts
export interface ToolContext {
  readonly cwd: string;
  readonly editMode: EditMode;
  readonly noopOwner: NoopLoopGuardOwner;
  readonly snapshotStore: InMemorySnapshotStore;
  readonly websearchOperations?: SearchOperations; // NEW
}
```

Registry factory:

```ts
websearch: (ctx) =>
  createWebSearchTool({ operations: ctx.websearchOperations }) as AgentTool,
```

When `websearchOperations` is `undefined` (e.g. tests), the tool's default operations throws `"websearch provider not configured"` — agents that declare the tool in production always get a resolved adapter (DDG at minimum).

### Runner wiring (`apps/server/src/agent/runner.ts`)

At the `toolCtx` construction site (`runner.ts:469`), resolve the adapter once per run:

```ts
const toolCtx: ToolContext = {
  cwd: project.cwd,
  editMode,
  snapshotStore: new InMemorySnapshotStore(),
  noopOwner: {},
  websearchOperations: resolveWebSearchOperations(ctx.auth, ctx.settings),
};
```

`ctx.auth` and `ctx.settings` are already on the server context.

## Permissions & agent wiring

- Tool: `permissions: (params) => [{ permission: "websearch", patterns: [(params as WebSearchToolInput).query] }]`.
- `server-agents.ts`: add `"websearch"` to `activeToolNames` of **build, general, intake, explore, plan**; add `websearch: "allow"` to each ruleset (explore: after `"*": "deny"` so last-match-wins permits it).

## Error handling

Throw `Error` objects (sakti convention). Adapter network failures surface as a generic `Web search failed for "<query>"` (do not interpolate untrusted response bodies into messages; the query is user/agent-authored so it may appear). Empty results are not an error — they return `NO_RESULTS_NOTICE`.

## Testing (TDD)

RED first, then GREEN. Suites:

1. **`websearch/__tests__/index.test.ts`** (fake operations):
   - Input validation: empty query rejected; `numResults` clamp (0 → 1, 99 → 20, omitted → 8).
   - Timeout: operations that never resolves → `Web search timed out` (fake timers).
   - External abort: signal already aborted → `Operation aborted`.
   - Empty results → `NO_RESULTS_NOTICE`, `details.count === 0`.
   - Rendering: 3 fake results → numbered list with title/url/snippet.
   - Truncation: oversized result set → notice appended, `details.truncation` set.
   - Permission declaration: `permissions({ query: "x" })` returns `[{ permission: "websearch", patterns: ["x"] }]`.
   - `operations` undefined (default) → throws `"websearch provider not configured"`.
2. **`adapters/__tests__/exa.test.ts`** (mocked `fetch`):
   - Request shape: URL with `exaApiKey` query param, JSON-RPC body, `Accept` header.
   - Direct JSON response → maps `result.content[].text`.
   - SSE `data:` response → maps first text payload.
   - Oversize body → aborts.
3. **`adapters/__tests__/tavily.test.ts`** (mocked `fetch`):
   - Request: `Authorization: Bearer`, body `{ query, max_results, include_answer: false }`.
   - Response `{ results: [{ title, url, content }] }` → mapped to `{ title, url, snippet }`.
4. **`adapters/__tests__/ddg.test.ts`** (canned HTML):
   - Lite HTML fixture → `{ title, url, snippet }`, dedup by URL, cap at `numResults`.
   - Empty/garbage HTML → `[]`.
5. **`auth-store` loosening** (extend existing suite):
   - `set("websearch:exa", "k")` returns true and `getApiKey("websearch:exa")` returns `"k"`.
   - `delete("websearch:exa")` returns true.
   - `set("websearch:", "k")` — bare prefix still rejected (must have a provider suffix).
   - `set("unknownprovider", "k")` still rejected (LLM validation intact).
6. **`websearch-resolver.test.ts`**:
   - provider `exa` + key present → `buildExaOperations`.
   - provider `exa` + key absent → DDG.
   - provider `tavily` + key → `buildTavilyOperations`.
   - absent/unknown provider → DDG.

## Dependencies

Add to `packages/tools/package.json`:

- `htmlparser2: ^9.1.0` — **already present** (webfetch). No new dep.

No other new runtime dependencies. Exa/Tavily/DDG all use the global `fetch` + `htmlparser2` (DDG only).

## Open questions / risks

- **Exa output shape ambiguity**: Exa's MCP `web_search_exa` returns markdown context text by default, not structured `{title,url,snippet}` rows. The adapter will best-effort parse a JSON array if present, else wrap the whole text as a single result snippet. If structured results are needed, the Exa MCP may support a different tool name / args — verified at adapter implementation time against a live key. This is the highest-uncertainty adapter.
- **DDG fragility**: DuckDuckGo Lite HTML is stable but unversioned; selectors may shift. The adapter returns `[]` on parse failure (graceful), so the worst case is "no results" not a crash. Acceptable for a zero-config fallback.
- **Key visibility in `list()`**: namespaced `websearch:*` keys are deliberately excluded from `list()` (LLM connect UI). A future websearch settings UI reads them via `getApiKey` directly.
- **No per-session provider override**: provider is global (`settings.json`), not per-profile/per-session. Sufficient for now; per-session is a follow-up if needed.
