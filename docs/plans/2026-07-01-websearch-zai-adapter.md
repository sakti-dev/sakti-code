# z.ai `web_search_prime` adapter — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a fourth websearch provider — z.ai's `web_search_prime` MCP tool — as `buildZaiOperations(apiKey)`, selectable via `provider: "zai"` in settings.json + a `websearch:zai` key in auth.json.

**Architecture:** Same `SearchOperations` DI seam as Exa/Tavily. The adapter is a standalone builder in `packages/tools/src/websearch/adapters/zai.ts`; the resolver gains one `provider === "zai"` branch. No changes to the tool, the auth store, or agent wiring — purely additive.

**Tech Stack:** TypeScript, Node global `fetch`, `collectBoundedBody` (reuse), vitest (`vite-plus/test`).

**Reverse-engineered contract** (from live introspection of `https://api.z.ai/api/mcp/web_search_prime/mcp`):

- Transport: **Streamable HTTP** (POST JSON-RPC; responses are **always SSE** `text/event-stream` with `id:`/`event:message`/`data:` lines, even for a single result).
- **Auth:** `Authorization: Bearer <apikey>` header on every request.
- **Handshake required:** first request is `initialize` → response includes an `mcp-session-id` **response header**; every later request must send `Mcp-Session-Id: <id>` as a **request header**. (`notifications/initialized` is NOT required — verified.)
- Protocol version returned: `2024-11-05`; server `mcp-web-search-prime` v0.0.1.
- **Tool:** `web_search_prime`. Arguments (`additionalProperties: false`):

  | param                   | type   | required | values                                            |
  | ----------------------- | ------ | -------- | ------------------------------------------------- |
  | `search_query`          | string | yes      | ≤70 chars recommended                             |
  | `search_domain_filter`  | string | no       | one domain, e.g. `www.example.com`                |
  | `search_recency_filter` | string | no       | `oneDay`/`oneWeek`/`oneMonth`/`oneYear`/`noLimit` |
  | `content_size`          | string | no       | `medium` (default) / `high`                       |
  | `location`              | string | no       | `cn` (default) / `us`                             |

- **Response quirk (double-encoded):** `result.content[0].text` is a **string** that must be `JSON.parse`d **again** to get the rows: `[{ "title", "link", "content", "refer" }]`. Map `link`→`url`, `content`→`snippet`; ignore `refer`.

**Conventions:** `exactOptionalPropertyTypes: true`; `const`-first; arrow callbacks; throw `Error` objects; tests import from `"vite-plus/test"`. Test cmd: `vp run '@sakti-code/tools#test'` / `vp run '@sakti-code/server#test'`. Lint: `vp check --fix`.

**Reusable:** `collectBoundedBody(stream, maxBytes)` at `packages/tools/src/webfetch/bounded-body.ts`.

**Reference adapters to mirror:** `packages/tools/src/websearch/adapters/exa.ts` (SSE `data:` parsing), `tavily.ts` (simple field mapping).

---

## Task 1: z.ai adapter (TDD)

**Files:**

- Create: `packages/tools/src/websearch/adapters/zai.ts`
- Test: `packages/tools/src/websearch/adapters/__tests__/zai.test.ts`

### Step 1: Write failing tests

Create `packages/tools/src/websearch/adapters/__tests__/zai.test.ts`. The mock `fetch` is **stateful**: call 1 (`initialize`) returns the session-id header + SSE init event; call 2 (`tools/call`) asserts the `Mcp-Session-Id` request header and returns the double-encoded result.

```ts
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { buildZaiOperations, ZAI_MCP_URL } from "../zai";

/** SSE body lines use `data:` with NO trailing space (z.ai's actual format). */
function sse(data: unknown): string {
  return `id:1\nevent:message\ndata:${JSON.stringify(data)}\n\n`;
}

describe("z.ai adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("handshakes (initialize -> session id), then calls web_search_prime with the session header", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      calls += 1;
      const body = init!.body as string;
      if (calls === 1) {
        expect(body).toContain('"initialize"');
        return new Response(
          sse({
            jsonrpc: "2.0",
            id: 1,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              serverInfo: { name: "mcp-web-search-prime", version: "0.0.1" },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream", "mcp-session-id": "sess-test" },
          },
        );
      }
      // call 2: tools/call
      expect(init!.headers).toMatchObject({ "Mcp-Session-Id": "sess-test" });
      expect(body).toContain('"web_search_prime"');
      expect(body).toContain('"search_query"');
      const rows = [{ title: "A", link: "https://a.example", content: "snip", refer: "ref_1" }];
      return new Response(
        sse({
          jsonrpc: "2.0",
          id: 2,
          result: { content: [{ type: "text", text: JSON.stringify(rows) }], isError: false },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await buildZaiOperations("k").search("vite monorepo", {
      numResults: 5,
      signal: new AbortController().signal,
    });

    expect(calls).toBe(2);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(ZAI_MCP_URL);
    expect(out.provider).toBe("zai");
    expect(out.results).toEqual([{ title: "A", url: "https://a.example", snippet: "snip" }]);
  });

  it("slices results to numResults", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        calls += 1;
        if (calls === 1) {
          return new Response(
            sse({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } }),
            {
              status: 200,
              headers: { "content-type": "text/event-stream", "mcp-session-id": "s" },
            },
          );
        }
        const rows = Array.from({ length: 10 }, (_, i) => ({
          title: `T${i}`,
          link: `https://${i}`,
          content: "c",
          refer: "r",
        }));
        return new Response(
          sse({
            jsonrpc: "2.0",
            id: 2,
            result: { content: [{ type: "text", text: JSON.stringify(rows) }], isError: false },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }),
    );
    const out = await buildZaiOperations("k").search("q", {
      numResults: 3,
      signal: new AbortController().signal,
    });
    expect(out.results).toHaveLength(3);
  });

  it("returns [] when the content text is empty", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(
            sse({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } }),
            {
              status: 200,
              headers: { "content-type": "text/event-stream", "mcp-session-id": "s" },
            },
          );
        }
        return new Response(
          sse({
            jsonrpc: "2.0",
            id: 2,
            result: { content: [{ type: "text", text: "[]" }], isError: false },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }),
    );
    const out = await buildZaiOperations("k").search("q", {
      numResults: 5,
      signal: new AbortController().signal,
    });
    expect(out.results).toEqual([]);
  });

  it("throws if initialize omits the session id header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(sse({ jsonrpc: "2.0", id: 1, result: {} }), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
      ),
    );
    await expect(
      buildZaiOperations("k").search("q", { numResults: 5, signal: new AbortController().signal }),
    ).rejects.toThrow(/session id/i);
  });
});
```

### Step 2: Run tests to verify they fail

```
vp run '@sakti-code/tools#test' -- websearch/adapters/zai
```

Expected: FAIL — module `../zai` does not exist.

### Step 3: Implement

Create `packages/tools/src/websearch/adapters/zai.ts`:

```ts
import { collectBoundedBody } from "../../webfetch/bounded-body.ts";
import type { SearchOperations, SearchResult } from "../index.ts";

export const ZAI_MCP_URL = "https://api.z.ai/api/mcp/web_search_prime/mcp";
export const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_LOCATION = "us";
const PROTOCOL_VERSION = "2024-11-05";

interface ZaiRow {
  title?: string;
  link?: string;
  content?: string;
  refer?: string;
}

/** Read the first `data:` line (no space after colon, per z.ai's format) and parse it. */
function parseSseJson(body: string): unknown | undefined {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractContentText(parsed: unknown): string | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const result = (parsed as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const first = content[0] as { text?: string } | undefined;
  return first?.text;
}

function baseHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
}

async function initialize(apiKey: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(ZAI_MCP_URL, {
    method: "POST",
    headers: baseHeaders(apiKey),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "sakti", version: "0.0.0" },
      },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`z.ai initialize HTTP ${response.status}`);
  // Drain the SSE body so the connection releases; we only need the header.
  await (response.body
    ? collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
    : Promise.resolve(new Uint8Array()));
  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("z.ai MCP did not return a session id");
  return sessionId;
}

export function buildZaiOperations(apiKey: string): SearchOperations {
  return {
    async search(query, opts) {
      const sessionId = await initialize(apiKey, opts.signal);
      const response = await fetch(ZAI_MCP_URL, {
        method: "POST",
        headers: { ...baseHeaders(apiKey), "Mcp-Session-Id": sessionId },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "web_search_prime",
            arguments: {
              search_query: query,
              content_size: "medium",
              location: DEFAULT_LOCATION,
            },
          },
        }),
        signal: opts.signal,
      });
      if (!response.ok) throw new Error(`z.ai HTTP ${response.status}`);
      const bytes = response.body
        ? await collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
        : new Uint8Array();
      const text = extractContentText(parseSseJson(new TextDecoder().decode(bytes))) ?? "[]";
      let rows: ZaiRow[] = [];
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) rows = parsed as ZaiRow[];
      } catch {
        rows = [];
      }
      const results: SearchResult[] = rows.map((r) => ({
        title: r.title ?? "",
        url: r.link ?? "",
        snippet: r.content ?? "",
      }));
      return { provider: "zai", results: results.slice(0, opts.numResults) };
    },
  };
}
```

### Step 4: Run tests to verify they pass

```
vp run '@sakti-code/tools#test' -- websearch/adapters/zai
```

Expected: all 4 PASS.

### Step 5: Commit

```bash
git add packages/tools/src/websearch/adapters/zai.ts packages/tools/src/websearch/adapters/__tests__/zai.test.ts
git commit -m "feat(tools): add z.ai web_search_prime adapter"
```

---

## Task 2: Export + resolver branch

**Files:**

- Modify: `packages/tools/src/index.ts` (add one export line)
- Modify: `apps/server/src/agent/config/websearch-resolver.ts` (add `provider === "zai"` branch)
- Modify: `apps/server/src/agent/config/__tests__/websearch-resolver.test.ts` (add zai cases)

### Step 2a: Export the builder

In `packages/tools/src/index.ts`, alongside the existing exa/tavily exports, add:

```ts
export { buildZaiOperations } from "./websearch/adapters/zai";
```

### Step 2b: Write failing resolver tests

Add to `apps/server/src/agent/config/__tests__/websearch-resolver.test.ts` (inside the existing `describe`):

```ts
it("returns z.ai operations when provider=zai and a key is present", () => {
  const { auth, settings } = setup({ provider: "zai" }, { "websearch:zai": "k" });
  expect(resolveWebSearchOperations(auth, settings)).toBeDefined();
});

it("returns undefined when provider=zai but no key", () => {
  const { auth, settings } = setup({ provider: "zai" });
  expect(resolveWebSearchOperations(auth, settings)).toBeUndefined();
});
```

Run: `vp run '@sakti-code/server#test' -- websearch-resolver` → expect FAIL (zai not wired).

### Step 2c: Add the resolver branch

In `apps/server/src/agent/config/websearch-resolver.ts`:

1. Add `buildZaiOperations` to the `@sakti-code/tools` import.
2. After the `tavily` branch, add:

```ts
if (provider === "zai") {
  const key = auth.getApiKey("websearch:zai");
  return key ? buildZaiOperations(key) : undefined;
}
```

Run: `vp run '@sakti-code/server#test' -- websearch-resolver` → expect PASS.

### Step 2d: Commit

```bash
git add packages/tools/src/index.ts apps/server/src/agent/config/websearch-resolver.ts apps/server/src/agent/config/__tests__/websearch-resolver.test.ts
git commit -m "feat(server): resolve z.ai websearch provider"
```

---

## Task 3: Verify

```
vp run -r test
vp check
vp run -r build
```

Expected: all green; no new deps; desktop main still externalized (no inlined workspace code — z.ai adapter is pure fetch + `collectBoundedBody`, no native or new imports).

Sanity: confirm `websearch:zai` is accepted by the auth store without an auth-store change — `/^websearch:[a-z]+$/` already matches it (the loosening in the earlier auth-store task covers it).

---

## Notes / decisions

- **Per-call handshake (2 requests/search).** Simplest; no session-expiry handling. If latency matters later, cache the session id on the adapter object and re-`initialize` only on a 4xx/missing-header failure. Out of scope for v1.
- **`location: "us"` hardcoded** (non-Chinese region) — best for English technical searches. To make it configurable later, extend `buildZaiOperations(apiKey, { location })` and read `settings.websearch.location` in the resolver. One-line default change if `"cn"` is preferred now.
- **`numResults` enforced client-side** via `.slice()` — z.ai has no count parameter (`content_size` controls summary length, not result count). z.ai returns ~10 rows; the tool's default `numResults` (8) slices it.
- **`notifications/initialized` NOT sent** — verified z.ai accepts `tools/call` immediately after `initialize` without it.
- **No auth-store change** — the existing `/^websearch:[a-z]+$/` gate already permits `websearch:zai`.
- **No agent/rule changes** — `websearch` is already registered + allowed in all five agents; this only adds a selectable backend.
