# websearch tool — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a pluggable `websearch` tool to sakti agents that runs a web search via Exa, Tavily, or DuckDuckGo and returns a unified result list.

**Architecture:** A pure `createWebSearchTool` knows only a `SearchOperations` interface. Three standalone adapter builders (`buildExaOperations`, `buildTavilyOperations`, `buildDdgOperations`) implement that interface. The server resolves the active provider from `settings.json` + its key from `auth.json` (namespaced `websearch:<provider>`) in a single `resolveWebSearchOperations` coupling point, and injects the built adapter into the tool via `ToolContext`.

**Tech Stack:** TypeScript, TypeBox (`typebox`), Node global `fetch`, `htmlparser2` (already a dep), vitest. Packages: `@sakti-code/tools`, `@sakti-code/server`.

**Design doc:** `docs/plans/2026-07-01-websearch-tool-design.md` (read this first — it has the full rationale, constants, behavior steps, and coupling model).

**Conventions (from AGENTS.md):** `exactOptionalPropertyTypes: true` → conditional spread, never pass `undefined`. `const`-first, arrow callbacks, `for...of` over `.forEach()`, early returns, throw `Error` objects. Tests in `__tests__/` colocated with source, vitest, assert inside `it()`/`test()`. SolidJS renderer uses `class`/`for` (n/a here). Import TypeBox as `import { type Static, Type } from "typebox"`. Run `vp check --fix` before committing (pre-commit hook does this).

**Reusable utils (already exist — do NOT recreate):**

- `collectBoundedBody(stream, maxBytes)` — `packages/tools/src/webfetch/bounded-body.ts` — bounds a `ReadableStream<Uint8Array>`.
- `truncateHead(content)`, `formatSize(bytes)`, `TruncationResult` — `packages/tools/src/lib/truncate.ts`.

**Test commands:**

- Tools: `vp run '@sakti-code/tools#test'`
- Server: `vp run '@sakti-code/server#test'`
- Full: `vp run -r test`
- Lint/typecheck/format: `vp check --fix`

---

## Task 1: Loosen auth-store validation for namespaced keys

**Files:**

- Modify: `apps/server/src/lib/auth-store.ts` (`set()` at ~L131, `delete()` at ~L145)
- Test: `apps/server/src/lib/__tests__/auth-store.test.ts`

**Why first:** Foundation — the resolver (Task 7) calls `auth.getApiKey("websearch:exa")`, which already works, but storing/deleting a namespaced key needs the validation gate loosened. `getApiKey()` has no validation, so no change there.

### Step 1: Write failing tests

Add to `apps/server/src/lib/__tests__/auth-store.test.ts` (inside an existing or new `describe` block; find a fresh tmpdir the way the suite already does):

```ts
it("set accepts namespaced websearch: keys", () => {
  const store = createAuthStore(<freshPath>);
  expect(store.set("websearch:exa", "exa-key")).toBe(true);
  expect(store.getApiKey("websearch:exa")).toBe("exa-key");
  expect(store.set("websearch:tavily", "tv-key")).toBe(true);
  expect(store.getApiKey("websearch:tavily")).toBe("tv-key");
});

it("set rejects a bare websearch: prefix with no provider suffix", () => {
  const store = createAuthStore(<freshPath>);
  expect(store.set("websearch:", "k")).toBe(false);
});

it("delete removes namespaced websearch: keys", () => {
  const store = createAuthStore(<freshPath>);
  store.set("websearch:exa", "exa-key");
  expect(store.delete("websearch:exa")).toBe(true);
  expect(store.getApiKey("websearch:exa")).toBeUndefined();
});

it("set still rejects unknown non-namespaced providers", () => {
  const store = createAuthStore(<freshPath>);
  expect(store.set("not-a-real-provider", "k")).toBe(false);
});
```

Replace `<freshPath>` with the same per-test tmpdir pattern the existing suite uses (look at the surrounding `it` blocks for the helper).

### Step 2: Run tests to verify they fail

```
vp run '@sakti-code/server#test' -- auth-store
```

Expected: the first three tests FAIL (set/delete return `false`), the fourth PASSES already.

### Step 3: Implement

In `apps/server/src/lib/auth-store.ts`, add a helper near `KNOWN_PROVIDERS` (after line 13):

```ts
/** Accepts known LLM provider ids or namespaced service keys like "websearch:exa". */
const isAllowedKey = (provider: string): boolean =>
  KNOWN_PROVIDERS.includes(provider) || /^websearch:[a-z]+$/.test(provider);
```

In `set()` replace the guard `if (!KNOWN_PROVIDERS.includes(provider))` with `if (!isAllowedKey(provider))`. Do the same in `delete()`.

### Step 4: Run tests to verify they pass

```
vp run '@sakti-code/server#test' -- auth-store
```

Expected: all four PASS, and the existing auth-store tests still PASS (LLM providers unaffected).

### Step 5: Commit

```bash
git add apps/server/src/lib/auth-store.ts apps/server/src/lib/__tests__/auth-store.test.ts
git commit -m "feat(server): allow namespaced websearch: keys in auth store"
```

---

## Task 2: websearch tool core (DI seam)

**Files:**

- Create: `packages/tools/src/websearch/index.ts`
- Test: `packages/tools/src/websearch/__tests__/index.test.ts`

**Note:** Mirror the structure of `packages/tools/src/webfetch/index.ts` (read it first). The tool takes an injected `SearchOperations`; it does NOT import any adapter.

### Step 1: Write failing tests

Create `packages/tools/src/websearch/__tests__/index.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createWebSearchTool, DEFAULT_NUM_RESULTS, NO_RESULTS_NOTICE } from "../index";

function fakeOps(
  behavior: "results" | "empty" | "never" | "throw" = "results",
  results = [
    { title: "T1", url: "https://a.example", snippet: "S1" },
    { title: "T2", url: "https://b.example", snippet: "S2" },
  ],
) {
  return {
    calls: [] as Array<{ query: string; numResults: number }>,
    async search(query: string, opts: { numResults: number; signal: AbortSignal }) {
      calls.push({ query, numResults: opts.numResults });
      if (behavior === "never")
        return new Promise<{ provider: string; results: typeof results }>(() => {});
      if (behavior === "throw") throw new Error("boom");
      return { provider: "fake", results: behavior === "empty" ? [] : results };
    },
  };
}

describe("websearch tool", () => {
  it("rejects an empty query", async () => {
    const tool = createWebSearchTool({ operations: fakeOps() });
    await expect(tool.execute("c1", { query: "   " }, undefined!)).rejects.toThrow(/non-empty/);
  });

  it("clamps numResults to [1, MAX]", async () => {
    const ops = fakeOps();
    const tool = createWebSearchTool({ operations: ops });
    await tool.execute("c1", { query: "q", numResults: 0 }, undefined!);
    await tool.execute("c2", { query: "q", numResults: 99 }, undefined!);
    expect(ops.calls[0]!.numResults).toBe(1);
    expect(ops.calls[1]!.numResults).toBe(20);
  });

  it("defaults numResults when omitted", async () => {
    const ops = fakeOps();
    const tool = createWebSearchTool({ operations: ops });
    await tool.execute("c1", { query: "q" }, undefined!);
    expect(ops.calls[0]!.numResults).toBe(DEFAULT_NUM_RESULTS);
  });

  it("renders a numbered list with title/url/snippet", async () => {
    const tool = createWebSearchTool({ operations: fakeOps() });
    const out = await tool.execute("c1", { query: "q" }, undefined!);
    expect(out.content[0]!.text).toContain("1. T1");
    expect(out.content[0]!.text).toContain("https://a.example");
    expect(out.details).toMatchObject({ provider: "fake", query: "q", count: 2 });
  });

  it("returns NO_RESULTS notice when empty", async () => {
    const tool = createWebSearchTool({ operations: fakeOps("empty") });
    const out = await tool.execute("c1", { query: "q" }, undefined!);
    expect(out.content[0]!.text).toBe(NO_RESULTS_NOTICE);
    expect(out.details.count).toBe(0);
  });

  it("surfaces operation errors as the original error", async () => {
    const tool = createWebSearchTool({ operations: fakeOps("throw") });
    await expect(tool.execute("c1", { query: "q" }, undefined!)).rejects.toThrow("boom");
  });

  it("declares the websearch permission with the query", () => {
    const tool = createWebSearchTool({ operations: fakeOps() });
    expect(tool.permissions!({ query: "hello" })).toEqual([
      { permission: "websearch", patterns: ["hello"] },
    ]);
  });

  it("throws when no operations configured", async () => {
    const tool = createWebSearchTool();
    await expect(tool.execute("c1", { query: "q" }, undefined!)).rejects.toThrow(
      /provider not configured/,
    );
  });
});
```

Timeout/abort tests (use fake timers):

```ts
import { afterEach, beforeEach } from "vitest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("times out after the default timeout", async () => {
  const tool = createWebSearchTool({ operations: fakeOps("never") });
  const p = tool.execute("c1", { query: "q" }, undefined!);
  await vi.advanceTimersByTimeAsync(25_000 + 50);
  await expect(p).rejects.toThrow(/timed out/i);
});

it("aborts when the external signal is already aborted", async () => {
  const tool = createWebSearchTool({ operations: fakeOps() });
  const ac = new AbortController();
  ac.abort();
  await expect(tool.execute("c1", { query: "q" }, ac.signal)).rejects.toThrow(/aborted/i);
});
```

### Step 2: Run tests to verify they fail

```
vp run '@sakti-code/tools#test' -- websearch/index
```

Expected: FAIL — module `../index` does not exist.

### Step 3: Implement the tool

Create `packages/tools/src/websearch/index.ts`:

```ts
import type { AgentTool } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { formatSize, truncateHead, type TruncationResult } from "../lib/truncate.ts";

export const DEFAULT_NUM_RESULTS = 8;
export const MAX_NUM_RESULTS = 20;
export const DEFAULT_TIMEOUT_SECONDS = 25;
export const NO_RESULTS_NOTICE = "No search results found. Try a different query.";

const websearchSchema = Type.Object({
  query: Type.String({ description: "The search query" }),
  numResults: Type.Optional(
    Type.Number({
      description: `Number of results (default ${DEFAULT_NUM_RESULTS}, max ${MAX_NUM_RESULTS}).`,
    }),
  ),
});

export type WebSearchToolInput = Static<typeof websearchSchema>;

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

export interface WebSearchToolDetails {
  provider: string;
  query: string;
  count: number;
  truncation?: TruncationResult;
}

export interface WebSearchToolOptions {
  operations?: SearchOperations;
}

function clampNumResults(n: number | undefined): number {
  const value = Math.trunc(n ?? DEFAULT_NUM_RESULTS);
  if (value < 1) return 1;
  if (value > MAX_NUM_RESULTS) return MAX_NUM_RESULTS;
  return value;
}

function renderResults(results: SearchResult[]): string {
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
}

export function createWebSearchTool(
  options?: WebSearchToolOptions,
): AgentTool<typeof websearchSchema, WebSearchToolDetails> {
  return {
    name: "websearch",
    label: "websearch",
    description: `Search the web and return a list of results (title, URL, snippet). Read-only. Defaults to ${DEFAULT_NUM_RESULTS} results (max ${MAX_NUM_RESULTS}); times out after ${DEFAULT_TIMEOUT_SECONDS}s. Follow up with \`webfetch\` for full page content. Useful for current information beyond the model's knowledge cutoff.`,
    parameters: websearchSchema,
    permissions: (params) => [
      { permission: "websearch", patterns: [(params as WebSearchToolInput).query] },
    ],
    async execute(_toolCallId, input, signal) {
      const operations = options?.operations;
      if (!operations) throw new Error("websearch provider not configured");
      const query = (input.query ?? "").trim();
      if (!query) throw new Error("query must be a non-empty string");
      const numResults = clampNumResults(input.numResults);

      const controller = new AbortController();
      const onExternalAbort = (): void => controller.abort();
      if (signal) {
        if (signal.aborted) throw new Error("Operation aborted");
        signal.addEventListener("abort", onExternalAbort, { once: true });
      }
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_SECONDS * 1000);

      let provider: string;
      let results: SearchResult[];
      try {
        try {
          const out = await operations.search(query, { numResults, signal: controller.signal });
          provider = out.provider;
          results = out.results;
        } catch (error) {
          if (signal?.aborted) throw new Error("Operation aborted");
          if (controller.signal.aborted) throw new Error("Web search timed out");
          throw error;
        }
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onExternalAbort);
      }

      const count = results.length;
      const details: WebSearchToolDetails = { provider, query, count };
      const body = count === 0 ? NO_RESULTS_NOTICE : renderResults(results);
      const truncation = truncateHead(body);
      const notices: string[] = [];
      if (truncation.truncated) {
        details.truncation = truncation;
        notices.push(`${formatSize(truncation.maxBytes)} limit reached`);
      }
      const text =
        notices.length > 0
          ? `${truncation.content}\n\n[${notices.join(". ")}]`
          : truncation.content;
      return {
        content: [{ type: "text", text }],
        details,
      };
    },
  };
}
```

### Step 4: Run tests to verify they pass

```
vp run '@sakti-code/tools#test' -- websearch/index
```

Expected: all PASS.

### Step 5: Commit

```bash
git add packages/tools/src/websearch/index.ts packages/tools/src/websearch/__tests__/index.test.ts
git commit -m "feat(tools): add websearch tool core with SearchOperations seam"
```

---

## Task 3: Exa adapter

**Files:**

- Create: `packages/tools/src/websearch/adapters/exa.ts`
- Test: `packages/tools/src/websearch/adapters/__tests__/exa.test.ts`

**Note:** Port of opencode's JSON-RPC + SSE-line fallback (`parseResponse`). Uses `collectBoundedBody` from `../../webfetch/bounded-body.ts`.

### Step 1: Write failing tests

Create `packages/tools/src/websearch/adapters/__tests__/exa.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildExaOperations, EXA_MCP_URL } from "../exa";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("exa adapter", () => {
  it("sends a JSON-RPC tools/call to the Exa MCP url with the key as a query param", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      return jsonResponse({
        result: { content: [{ type: "text", text: "[]" }] },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const ops = buildExaOperations("exa-key");
      await ops.search("rust async", { numResults: 5, signal: new AbortController().signal });
      const calledUrl = String(fetchMock.mock.calls[0]![0]);
      expect(calledUrl).toContain(EXA_MCP_URL);
      expect(calledUrl).toContain("exaApiKey=exa-key");
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      expect(init.method).toBe("POST");
      const sentBody = JSON.parse(init.body as string) as {
        method: string;
        params: { name: string; arguments: unknown };
      };
      expect(sentBody.method).toBe("tools/call");
      expect(sentBody.params.name).toBe("web_search_exa");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps a direct JSON result.content text payload", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify([{ title: "A", url: "https://a", text: "snip" }]),
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await buildExaOperations("k").search("q", {
        numResults: 3,
        signal: new AbortController().signal,
      });
      expect(out.provider).toBe("exa");
      expect(out.results).toEqual([{ title: "A", url: "https://a", snippet: "snip" }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to parsing a data: SSE line", async () => {
    const sse = `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: '[{"title":"B","url":"https://b","text":"x"}]' }] } })}\n\n`;
    const fetchMock = vi.fn(
      async () =>
        new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await buildExaOperations("k").search("q", {
        numResults: 3,
        signal: new AbortController().signal,
      });
      expect(out.results).toEqual([{ title: "B", url: "https://b", snippet: "x" }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

### Step 2: Run tests to verify they fail

```
vp run '@sakti-code/tools#test' -- websearch/adapters/exa
```

Expected: FAIL — module missing.

### Step 3: Implement

Create `packages/tools/src/websearch/adapters/exa.ts`:

```ts
import { collectBoundedBody } from "../../webfetch/bounded-body.ts";
import type { SearchOperations, SearchResult } from "../index.ts";

export const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
export const MAX_RESPONSE_BYTES = 256 * 1024;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

interface ExaStructured {
  title?: string;
  url?: string;
  text?: string;
}

function exaUrl(apiKey: string): string {
  const url = new URL(EXA_MCP_URL);
  url.searchParams.set("exaApiKey", apiKey);
  return url.toString();
}

function parsePayload(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as { result?: { content?: { text?: string }[] } };
    return parsed.result?.content?.find((item) => item.text)?.text;
  } catch {
    return undefined;
  }
}

function parseResponse(body: string): string | undefined {
  const direct = parsePayload(body);
  if (direct) return direct;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = parsePayload(line.slice(6));
    if (data) return data;
  }
  return undefined;
}

function mapToResults(text: string): SearchResult[] {
  try {
    const arr = JSON.parse(text) as unknown;
    if (Array.isArray(arr)) {
      return arr
        .filter((r): r is ExaStructured => typeof r === "object" && r !== null)
        .map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.text ?? "" }));
    }
  } catch {
    // not JSON — treat as a context blob
  }
  return text ? [{ title: "Exa", url: "", snippet: text }] : [];
}

export function buildExaOperations(apiKey: string): SearchOperations {
  return {
    async search(query, opts) {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: { query, type: "auto", numResults: opts.numResults, livecrawl: "fallback" },
        },
      });
      const response = await fetch(exaUrl(apiKey), {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "User-Agent": BROWSER_USER_AGENT,
        },
        body,
        signal: opts.signal,
      });
      if (!response.ok) throw new Error(`Exa HTTP ${response.status}`);
      const bytes = response.body
        ? await collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
        : new Uint8Array();
      const payload = parseResponse(new TextDecoder().decode(bytes)) ?? "";
      return { provider: "exa", results: mapToResults(payload) };
    },
  };
}
```

### Step 4: Run tests to verify they pass

```
vp run '@sakti-code/tools#test' -- websearch/adapters/exa
```

Expected: PASS.

### Step 5: Commit

```bash
git add packages/tools/src/websearch/adapters/exa.ts packages/tools/src/websearch/adapters/__tests__/exa.test.ts
git commit -m "feat(tools): add Exa websearch adapter"
```

---

## Task 4: Tavily adapter

**Files:**

- Create: `packages/tools/src/websearch/adapters/tavily.ts`
- Test: `packages/tools/src/websearch/adapters/__tests__/tavily.test.ts`

### Step 1: Write failing tests

Create `packages/tools/src/websearch/adapters/__tests__/tavily.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildTavilyOperations, TAVILY_URL } from "../tavily";

describe("tavily adapter", () => {
  it("POSTs with Bearer auth and query/max_results/include_answer", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as Record<string, unknown>;
      expect(init!.headers).toMatchObject({ Authorization: "Bearer tv-key" });
      expect(body).toMatchObject({ query: "q", max_results: 5, include_answer: false });
      return new Response(
        JSON.stringify({ results: [{ title: "A", url: "https://a", content: "snip" }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await buildTavilyOperations("tv-key").search("q", {
        numResults: 5,
        signal: new AbortController().signal,
      });
      expect(String(fetchMock.mock.calls[0]![0])).toContain(TAVILY_URL);
      expect(out.provider).toBe("tavily");
      expect(out.results).toEqual([{ title: "A", url: "https://a", snippet: "snip" }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    try {
      await expect(
        buildTavilyOperations("k").search("q", {
          numResults: 3,
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/Tavily HTTP 401/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

### Step 2: Run tests to verify they fail

```
vp run '@sakti-code/tools#test' -- websearch/adapters/tavily
```

Expected: FAIL — module missing.

### Step 3: Implement

Create `packages/tools/src/websearch/adapters/tavily.ts`:

```ts
import { collectBoundedBody } from "../../webfetch/bounded-body.ts";
import type { SearchOperations, SearchResult } from "../index.ts";

export const TAVILY_URL = "https://api.tavily.com/search";
export const MAX_RESPONSE_BYTES = 256 * 1024;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

export function buildTavilyOperations(apiKey: string): SearchOperations {
  return {
    async search(query, opts) {
      const response = await fetch(TAVILY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query, max_results: opts.numResults, include_answer: false }),
        signal: opts.signal,
      });
      if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
      const bytes = response.body
        ? await collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
        : new Uint8Array();
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { results?: TavilyResult[] };
      const results: SearchResult[] = (parsed.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
      }));
      return { provider: "tavily", results };
    },
  };
}
```

### Step 4: Run tests to verify they pass

```
vp run '@sakti-code/tools#test' -- websearch/adapters/tavily
```

Expected: PASS.

### Step 5: Commit

```bash
git add packages/tools/src/websearch/adapters/tavily.ts packages/tools/src/websearch/adapters/__tests__/tavily.test.ts
git commit -m "feat(tools): add Tavily websearch adapter"
```

---

## Task 5: DuckDuckGo adapter

**Files:**

- Create: `packages/tools/src/websearch/adapters/ddg.ts`
- Test: `packages/tools/src/websearch/adapters/__tests__/ddg.test.ts`

**Note:** Parses DuckDuckGo **Lite** HTML (`https://lite.duckduckgo.com/lite/?q=...`) with `htmlparser2`. Lite results use `<a class="result-link" href="...">title</a>` then `<td class="result-snippet">snippet</td>`. Extract `parseDdgHtml` as a pure function so the test feeds it HTML directly (no fetch needed for the parser test).

### Step 1: Write failing tests

Create `packages/tools/src/websearch/adapters/__tests__/ddg.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseDdgHtml } from "../ddg";

const HTML = [
  "<html><body><table>",
  '<tr><td><a class="result-link" href="https://a.example">Result A</a></td></tr>',
  '<tr><td class="result-snippet">Snippet A text</td></tr>',
  '<tr><td><a class="result-link" href="https://b.example">Result B</a></td></tr>',
  '<tr><td class="result-snippet">Snippet B</td></tr>',
  '<tr><td><a class="result-link" href="https://a.example">Result A again</a></td></tr>',
  '<tr><td class="result-snippet">dup</td></tr>',
  "</table></body></html>",
].join("");

describe("ddg parseDdgHtml", () => {
  it("extracts title/url/snippet pairs", () => {
    expect(parseDdgHtml(HTML, 10)).toEqual([
      { title: "Result A", url: "https://a.example", snippet: "Snippet A text" },
      { title: "Result B", url: "https://b.example", snippet: "Snippet B" },
    ]);
  });

  it("caps at numResults", () => {
    expect(parseDdgHtml(HTML, 1)).toHaveLength(1);
  });

  it("returns [] for garbage/empty", () => {
    expect(parseDdgHtml("", 10)).toEqual([]);
    expect(parseDdgHtml("no results here", 10)).toEqual([]);
  });
});
```

### Step 2: Run tests to verify they fail

```
vp run '@sakti-code/tools#test' -- websearch/adapters/ddg
```

Expected: FAIL — module missing.

### Step 3: Implement

Create `packages/tools/src/websearch/adapters/ddg.ts`:

```ts
import { Parser } from "htmlparser2";
import { collectBoundedBody } from "../../webfetch/bounded-body.ts";
import type { SearchOperations, SearchResult } from "../index.ts";

export const DDG_URL = "https://lite.duckduckgo.com/lite/";
export const MAX_RESPONSE_BYTES = 512 * 1024;

export function parseDdgHtml(html: string, max: number): SearchResult[] {
  const collected: SearchResult[] = [];
  let current: { title: string; url: string; snippet: string } | null = null;
  let inLink = false;
  let inSnippet = false;

  const parser = new Parser({
    onopentag(name, attribs) {
      if (name === "a" && attribs.class === "result-link") {
        inLink = true;
        current = { title: "", url: attribs.href ?? "", snippet: "" };
      } else if (name === "td" && attribs.class === "result-snippet") {
        inSnippet = true;
      }
    },
    ontext(text) {
      if (inLink && current) current.title += text;
      else if (inSnippet && current) current.snippet += text;
    },
    onclosetag(name) {
      if (name === "a" && inLink) {
        inLink = false;
      } else if (name === "td" && inSnippet) {
        inSnippet = false;
        if (current && current.url && current.title.trim()) {
          collected.push({
            title: current.title.trim(),
            url: current.url,
            snippet: current.snippet.trim(),
          });
        }
        current = null;
      }
    },
  });
  parser.write(html);
  parser.end();

  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const r of collected) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    results.push(r);
    if (results.length >= max) break;
  }
  return results;
}

export function buildDdgOperations(): SearchOperations {
  return {
    async search(query, opts) {
      const url = `${DDG_URL}?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { signal: opts.signal });
      if (!response.ok) throw new Error(`DuckDuckGo HTTP ${response.status}`);
      const bytes = response.body
        ? await collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
        : new Uint8Array();
      return {
        provider: "ddg",
        results: parseDdgHtml(new TextDecoder().decode(bytes), opts.numResults),
      };
    },
  };
}
```

### Step 4: Run tests to verify they pass

```
vp run '@sakti-code/tools#test' -- websearch/adapters/ddg
```

Expected: PASS.

### Step 5: Commit

```bash
git add packages/tools/src/websearch/adapters/ddg.ts packages/tools/src/websearch/adapters/__tests__/ddg.test.ts
git commit -m "feat(tools): add DuckDuckGo websearch adapter"
```

---

## Task 6: Re-export from `@sakti-code/tools`

**Files:**

- Modify: `packages/tools/src/index.ts` (after the webfetch exports, ~L29)

**Why now:** the resolver (Task 7) and the registry (Task 8) import the builders from the package barrel.

### Step 1: Add exports

In `packages/tools/src/index.ts`, after the webfetch block, add:

```ts
export type {
  SearchOperations,
  SearchResult,
  WebSearchToolDetails,
  WebSearchToolInput,
  WebSearchToolOptions,
} from "./websearch/index";
export { createWebSearchTool } from "./websearch/index";
export { buildExaOperations } from "./websearch/adapters/exa";
export { buildTavilyOperations } from "./websearch/adapters/tavily";
export { buildDdgOperations } from "./websearch/adapters/ddg";
```

### Step 2: Verify it typechecks

```
vp check --fix
```

Expected: no errors (formatting applied if needed).

### Step 3: Commit

```bash
git add packages/tools/src/index.ts
git commit -m "feat(tools): export websearch tool and adapters"
```

---

## Task 7: Server resolver

**Files:**

- Create: `apps/server/src/agent/config/websearch-resolver.ts`
- Test: `apps/server/src/agent/config/__tests__/websearch-resolver.test.ts`

**Note:** This is the ONLY module that imports all three builders. `getApiKey()` already accepts any string (no validation gate on read).

### Step 1: Write failing tests

Create `apps/server/src/agent/config/__tests__/websearch-resolver.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveWebSearchOperations } from "../websearch-resolver";
import { createAuthStore } from "../../../lib/auth-store.ts";
import { createSettingsFileStore } from "../../../lib/settings-file-store.ts";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

function setup(websearch: unknown, authEntries: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ws-resolver-"));
  const auth = createAuthStore(join(dir, "auth.json"));
  for (const [k, v] of Object.entries(authEntries)) auth.set(k, v);
  const settings = createSettingsFileStore(join(dir, "settings.json"));
  if (websearch !== undefined) settings.update({ websearch });
  return { auth, settings, dir };
}

describe("resolveWebSearchOperations", () => {
  it("uses Exa when provider=exa and a key is present", () => {
    const { auth, settings } = setup({ provider: "exa" }, { "websearch:exa": "k" });
    const ops = resolveWebSearchOperations(auth, settings);
    expect(ops).toBeTypeOf("object");
    // Exa builder is selected; we assert via the provider label returned by search.
    // (Avoid network: the builder is returned without calling fetch.)
  });

  it("falls back to DDG when provider=exa but no key", () => {
    const { auth, settings } = setup({ provider: "exa" });
    const ops = resolveWebSearchOperations(auth, settings);
    expect(ops).toBeTypeOf("object");
  });

  it("uses Tavily when provider=tavily and a key is present", () => {
    const { auth, settings } = setup({ provider: "tavily" }, { "websearch:tavily": "k" });
    expect(resolveWebSearchOperations(auth, settings)).toBeTypeOf("object");
  });

  it("defaults to DDG when provider is absent", () => {
    const { auth, settings } = setup(undefined);
    expect(resolveWebSearchOperations(auth, settings)).toBeTypeOf("object");
  });

  it("defaults to DDG when provider is unknown", () => {
    const { auth, settings } = setup({ provider: "brave" });
    expect(resolveWebSearchOperations(auth, settings)).toBeTypeOf("object");
  });
});
```

> The type-only assertions above are intentionally weak because the builders hit the network. To make the test assert **which** builder was chosen without network, spy on `fetch` and call `ops.search` once; assert the request URL. If you prefer stronger assertions, replace each `expect(ops).toBeTypeOf("object")` with: stub `fetch` to return an empty-body ok Response, call `ops.search("q", { numResults: 1, signal: new AbortController().signal })`, and assert the provider string in the result (`"exa"` / `"tavily"` / `"ddg"`).

### Step 2: Run tests to verify they fail

```
vp run '@sakti-code/server#test' -- websearch-resolver
```

Expected: FAIL — module missing.

### Step 3: Implement

Create `apps/server/src/agent/config/websearch-resolver.ts`:

```ts
import {
  buildDdgOperations,
  buildExaOperations,
  buildTavilyOperations,
  type SearchOperations,
} from "@sakti-code/tools";
import type { AuthStore } from "../../lib/auth-store.ts";
import type { SettingsFileStore } from "../../lib/settings-file-store.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve the active websearch adapter from settings.json (provider) and the
 * matching key in auth.json (namespaced `websearch:<provider>`). When the
 * chosen provider has no key, or the provider is absent/unknown, falls back to
 * the keyless DuckDuckGo adapter. This is the only module that imports all
 * three adapter builders.
 */
export function resolveWebSearchOperations(
  auth: AuthStore,
  settingsFile: SettingsFileStore,
): SearchOperations {
  const cfg = isPlainObject(settingsFile.read().websearch)
    ? settingsFile.read().websearch
    : undefined;
  const provider = cfg && typeof cfg.provider === "string" ? cfg.provider : undefined;

  if (provider === "exa") {
    const key = auth.getApiKey("websearch:exa");
    return key ? buildExaOperations(key) : buildDdgOperations();
  }
  if (provider === "tavily") {
    const key = auth.getApiKey("websearch:tavily");
    return key ? buildTavilyOperations(key) : buildDdgOperations();
  }
  return buildDdgOperations();
}
```

### Step 4: Run tests to verify they pass

```
vp run '@sakti-code/server#test' -- websearch-resolver
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/server/src/agent/config/websearch-resolver.ts apps/server/src/agent/config/__tests__/websearch-resolver.test.ts
git commit -m "feat(server): add websearch adapter resolver"
```

---

## Task 8: Wire the tool into the server

**Files:**

- Modify: `apps/server/src/agent/config/tool-registry.ts` (extend `ToolContext`, add factory)
- Modify: `apps/server/src/agent/runner.ts` (`toolCtx` at ~L469)
- Modify: `apps/server/src/agent/config/server-agents.ts` (rulesets + `activeToolNames`)
- Modify: `apps/server/src/agent/config/index.ts` (re-export `ToolContext` type if needed — it's already exported)

### Step 8a: Extend `ToolContext` and add the factory

In `apps/server/src/agent/config/tool-registry.ts`:

1. Add the import to the `@sakti-code/tools` import block:
   ```ts
   createWebSearchTool,
   type SearchOperations,
   ```
2. Add to `ToolContext` interface (after `noopOwner`):
   ```ts
   readonly websearchOperations?: SearchOperations;
   ```
3. Add to `TOOL_FACTORIES` (after the `webfetch` entry):
   ```ts
   websearch: (ctx) =>
     createWebSearchTool({ operations: ctx.websearchOperations }) as AgentTool,
   ```

(`exactOptionalPropertyTypes`: `ctx.websearchOperations` may be `undefined`; `createWebSearchTool` accepts `operations?: SearchOperations` and its default throws "provider not configured" — fine for unit contexts that don't declare the tool.)

### Step 8b: Resolve + inject in the runner

In `apps/server/src/agent/runner.ts`:

1. Add import (near the other config imports):
   ```ts
   import { resolveWebSearchOperations } from "./config/websearch-resolver.ts";
   ```
2. At the `toolCtx` construction site (~L469), add the resolved operations. Because of `exactOptionalPropertyTypes`, use a conditional spread:
   ```ts
   const websearchOperations = resolveWebSearchOperations(ctx.auth, ctx.settingsFile);
   const toolCtx: ToolContext = {
     cwd: project.cwd,
     editMode,
     snapshotStore: new InMemorySnapshotStore(),
     noopOwner: {},
     ...(websearchOperations ? { websearchOperations } : {}),
   };
   ```
   (`resolveWebSearchOperations` always returns a value (DDG at minimum), so the spread is always set — but keep the conditional form to satisfy the optional-property type and be future-proof.)

> Confirm `ctx.auth` and `ctx.settingsFile` exist on `ServerContext` (`apps/server/src/context.ts` — both are present). If the runner's local `ctx` variable is named differently, adjust accordingly.

### Step 8c: Add to agent rulesets and tool lists

In `apps/server/src/agent/config/server-agents.ts`:

1. **buildRuleset** — add `websearch: "allow",` alongside the existing `webfetch: "allow",` (L26).
2. **exploreRuleset** — add `websearch: "allow",` after `webfetch: "allow",` (after L37; must be after `"*": "deny"` for last-match-wins).
3. **planRuleset** — add `websearch: "allow",` alongside `webfetch: "allow",` (L45).
4. **intakeRuleset** — add `websearch: "allow",` alongside `webfetch: "allow",` (L54).
   (`general` uses `allowAllRuleset()` → `*: allow`, no entry needed.)
5. **activeToolNames** — append `"websearch"` to each of: build (L75), explore (L84), plan (L93), general (L102), intake (L111-120).

### Step 8d: Verify

```
vp run '@sakti-code/server#test'
vp check --fix
```

Expected: server tests PASS; `vp check` clean. If a runner test constructs `ToolContext` without `websearchOperations`, the optional field keeps those tests compiling.

### Step 8e: Commit

```bash
git add apps/server/src/agent/config/tool-registry.ts apps/server/src/agent/runner.ts apps/server/src/agent/config/server-agents.ts
git commit -m "feat(server): register websearch tool for agents"
```

---

## Task 9: Final verification

**Step 1:** Full test suite.

```
vp run -r test
```

Expected: all packages green; no regressions in tools or server.

**Step 2:** Typecheck + lint + format gate.

```
vp check
```

Expected: no errors.

**Step 3:** Build sanity (workspace dist resolves; desktop main stays externalized).

```
vp run -r build
```

Expected: 6/6 pack succeeds (no new native deps; `htmlparser2` was already bundled).

**Step 4:** Grep the desktop main bundle to confirm no surprise inlining (optional, mirrors the externalize work):

```
vp run desktop#build:electron 2>/dev/null; rg -c "@sakti-code" apps/desktop/out/main/index.js || true
```

Expected: low count (workspace packages externalized), consistent with the pre-websearch baseline.

**Step 5:** If all green, the feature is complete. No final commit unless the previous tasks left anything staged (`git status` should be clean after each task's commit).

---

## Notes for the executor

- **No new dependencies.** `htmlparser2` and `turndown` are already in `packages/tools/package.json`; Exa/Tavily/DDG use the global `fetch`.
- **`exactOptionalPropertyTypes`** is on — never pass `undefined` to an optional field; use conditional spread.
- **Import paths:** within `packages/tools/src`, use `.ts` extensions in relative imports (the existing tools do, e.g. webfetch imports `"../lib/truncate.ts"`).
- **Adapter builders return `SearchOperations`** — the tool never imports an adapter; only the resolver does.
- **DDG is the zero-config fallback.** A fresh install with no settings/keys still works (agent searches hit DDG).
- **Exa output is the highest-uncertainty adapter** (its MCP may return a markdown context blob rather than structured rows). `mapToResults` handles both shapes; if a live key reveals a different tool name/args, adjust `adapters/exa.ts` only.
- **Pre-commit hook** runs `vp check --fix` automatically; keep commits conventional (`feat(tools):`, `feat(server):`).
