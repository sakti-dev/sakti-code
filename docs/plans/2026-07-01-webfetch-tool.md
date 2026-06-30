# webfetch Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a read-only `webfetch` tool to `@sakti-code/tools` that fetches an HTTP(S) URL and returns its content as markdown (default), text, or HTML — a faithful behavioral port of opencode's `webfetch`, adapted to sakti's plain-TS + Node conventions.

**Architecture:** Standalone `createWebFetchTool(options?)` factory returning an `AgentTool` (TypeBox schema). A `WebFetchOperations` DI seam wraps HTTP so tests inject a fake `fetch` (no network, no global mocking). Pure HTML converters (`turndown` for markdown, `htmlparser2` for text) live in `lib/html-convert.ts`. A bounded body collector enforces the 5 MiB raw cap. Wired into the server via `TOOL_FACTORIES` + per-agent `activeToolNames`/rulesets.

**Tech Stack:** TypeScript, TypeBox, Node global `fetch`, `turndown@^7`, `htmlparser2@^9`, vitest via `vite-plus/test`.

**Design doc:** `docs/plans/2026-07-01-webfetch-tool-design.md`

**Conventions (from AGENTS.md):**

- Tests import from `"vite-plus/test"`, colocated in `__tests__/`.
- `exactOptionalPropertyTypes: true` — use conditional spread, never pass `undefined`.
- `const` by default; arrow callbacks; early returns; throw `Error` objects.
- Commit style: `feat(tools): …`, conventional commits.
- Test invocation: `vp run '@sakti-code/tools#test'`.

---

### Task 1: Add dependencies

**Files:**

- Modify: `packages/tools/package.json`

**Step 1: Add `turndown` and `htmlparser2` to dependencies**

Add to the `dependencies` object in `packages/tools/package.json` (keep alphabetical-ish order with the existing entries):

```json
    "htmlparser2": "^9.1.0",
    "turndown": "^7.2.0",
```

**Step 2: Install**

Run: `vp install`
Expected: install succeeds; `turndown` and `htmlparser2` appear under `node_modules`.

**Step 3: Smoke-verify both libs load in Node**

Run:

```bash
node --input-type=module -e "import TurndownService from 'turndown'; import { Parser } from 'htmlparser2'; const td = new TurndownService(); td.remove(['script']); console.log(td.turndown('<h1>Hi</h1><script>x</script>')); const p = new Parser({ontext:t=>process.stdout.write(t)}); p.write('<p>a</p>'); p.end();"
```

Expected: prints `# Hi` then `a` (no `x` from the script). Run from `packages/tools` if module resolution needs the workspace node_modules: `vp run -T -- node …` or just `cd packages/tools && node …`. If it works from repo root, fine.

**Step 4: Commit**

```bash
git add pnpm-lock.yaml packages/tools/package.json
git commit -m "chore(tools): add turndown and htmlparser2 for webfetch"
```

---

### Task 2: Pure HTML converters (`lib/html-convert.ts`) — TDD

**Files:**

- Create: `packages/tools/src/lib/html-convert.ts`
- Test: `packages/tools/src/lib/__tests__/html-convert.test.ts`

**Verified expected outputs** (run against real libs before writing the plan):

- `<h1>Title</h1><h2>Sub</h2>` → `# Title\n\n## Sub`
- `<p>Hello <b>world</b></p>` → `Hello **world**`
- `<p>x</p><script>alert(1)</script>` (after `.remove(["script",...])`) → `x`
- `<meta charset="utf-8"><style>p{}</style><p>y</p>` → `y`
- text `<p>Hello <b>world</b></p>` → `Hello world`
- text skip of script/style/noscript/iframe → `visible`
- text trim → `hi`

**Step 1: Write the failing test**

`packages/tools/src/lib/__tests__/html-convert.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { convertHTMLToMarkdown, extractTextFromHTML } from "../html-convert.ts";

describe("convertHTMLToMarkdown", () => {
  it("converts headings to atx", () => {
    expect(convertHTMLToMarkdown("<h1>Title</h1><h2>Sub</h2>")).toBe("# Title\n\n## Sub");
  });

  it("converts bold to **", () => {
    expect(convertHTMLToMarkdown("<p>Hello <b>world</b></p>")).toBe("Hello **world**");
  });

  it("strips script bodies", () => {
    expect(convertHTMLToMarkdown("<p>x</p><script>alert(1)</script>")).toBe("x");
  });

  it("strips style/meta/link", () => {
    expect(convertHTMLToMarkdown('<meta charset="utf-8"><style>p{}</style><p>y</p>')).toBe("y");
  });
});

describe("extractTextFromHTML", () => {
  it("strips tags and keeps text", () => {
    expect(extractTextFromHTML("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("excludes script/style/noscript/iframe content", () => {
    const html =
      "<p>visible</p><script>s1</script><style>s2</style><noscript>s3</noscript><iframe>s4</iframe>";
    expect(extractTextFromHTML(html)).toBe("visible");
  });

  it("trims surrounding whitespace", () => {
    expect(extractTextFromHTML("  <p>  hi  </p>  ")).toBe("hi");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/tools#test' -- --run src/lib/__tests__/html-convert.test.ts`
Expected: FAIL — module `../html-convert.ts` not found.

**Step 3: Write minimal implementation**

`packages/tools/src/lib/html-convert.ts`:

```ts
import TurndownService from "turndown";
import { Parser } from "htmlparser2";

const SKIP_TAGS = ["script", "style", "noscript", "iframe", "object", "embed"];

export function convertHTMLToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  turndown.remove(["script", "style", "meta", "link"]);
  return turndown.turndown(html);
}

export function extractTextFromHTML(html: string): string {
  let text = "";
  let skipDepth = 0;
  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || SKIP_TAGS.includes(name)) skipDepth++;
    },
    ontext(input) {
      if (skipDepth === 0) text += input;
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--;
    },
  });
  parser.write(html);
  parser.end();
  return text.trim();
}
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/tools#test' -- --run src/lib/__tests__/html-convert.test.ts`
Expected: PASS (7 tests).

**Step 5: Commit**

```bash
git add packages/tools/src/lib/html-convert.ts packages/tools/src/lib/__tests__/html-convert.test.ts
git commit -m "feat(tools): add HTML-to-markdown and text converters"
```

---

### Task 3: Bounded body collector (`webfetch/bounded-body.ts`) — TDD

**Files:**

- Create: `packages/tools/src/webfetch/bounded-body.ts`
- Test: `packages/tools/src/webfetch/__tests__/bounded-body.test.ts`

**Step 1: Write the failing test**

`packages/tools/src/webfetch/__tests__/bounded-body.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { collectBoundedBody } from "../bounded-body.ts";

function makeStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

const enc = new TextEncoder();

describe("collectBoundedBody", () => {
  it("concatenates chunks under the limit", async () => {
    const out = await collectBoundedBody(makeStream(enc.encode("ab"), enc.encode("cd")), 100);
    expect(new TextDecoder().decode(out)).toBe("abcd");
  });

  it("returns an empty array for an empty stream", async () => {
    const out = await collectBoundedBody(makeStream(), 100);
    expect(out.byteLength).toBe(0);
  });

  it("throws when the body exceeds the limit", async () => {
    await expect(collectBoundedBody(makeStream(enc.encode("hello")), 3)).rejects.toThrow(
      /Response too large/,
    );
  });

  it("accepts a body exactly at the limit", async () => {
    const out = await collectBoundedBody(makeStream(enc.encode("abc")), 3);
    expect(new TextDecoder().decode(out)).toBe("abc");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/tools#test' -- --run src/webfetch/__tests__/bounded-body.test.ts`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

`packages/tools/src/webfetch/bounded-body.ts`:

```ts
export async function collectBoundedBody(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        throw new Error(`Response too large (exceeds ${maxBytes} byte limit)`);
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/tools#test' -- --run src/webfetch/__tests__/bounded-body.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add packages/tools/src/webfetch/bounded-body.ts packages/tools/src/webfetch/__tests__/bounded-body.test.ts
git commit -m "feat(tools): add bounded response body collector"
```

---

### Task 4: The `webfetch` tool (`webfetch/index.ts`) — TDD

**Files:**

- Create: `packages/tools/src/webfetch/index.ts`
- Test: `packages/tools/src/webfetch/__tests__/webfetch.test.ts`

This is the largest task. Each `it()` is its own RED→GREEN cycle; write the whole test file first (it will fail on import), then implement, then run.

**Step 1: Write the failing test**

`packages/tools/src/webfetch/__tests__/webfetch.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createWebFetchTool, type WebFetchOperations, type WebFetchResponse } from "../index.ts";

function res(opts: Partial<WebFetchResponse> & { status?: number }): WebFetchResponse {
  return {
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "",
    headers: opts.headers ?? {},
    bytes: opts.bytes ?? new TextEncoder().encode(opts.body ?? ""),
  };
}

function fakeOps(responses: WebFetchResponse[], { hang = false }: { hang?: boolean } = {}) {
  const calls: { url: string; init: { headers: Record<string, string>; signal: AbortSignal } }[] =
    [];
  let i = 0;
  const operations: WebFetchOperations = {
    async fetch(url, init) {
      calls.push({ url, init });
      if (hang) return new Promise<WebFetchResponse>(() => {});
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    },
  };
  return { operations, calls };
}

describe("webfetch permission declaration", () => {
  it("declares webfetch + the url", () => {
    const tool = createWebFetchTool();
    expect(tool.permissions?.({ url: "https://x.test" })).toEqual([
      { permission: "webfetch", patterns: ["https://x.test"] },
    ]);
  });
});

describe("webfetch URL validation", () => {
  it("rejects non-http(s) protocols", async () => {
    const tool = createWebFetchTool();
    await expect(tool.execute("t1", { url: "ftp://x.test" })).rejects.toThrow(
      "URL must use http:// or https://",
    );
  });

  it("rejects malformed URLs", async () => {
    const tool = createWebFetchTool();
    await expect(tool.execute("t1", { url: "not a url" })).rejects.toThrow(/Invalid URL/);
  });
});

describe("webfetch format dispatch", () => {
  it("converts HTML to markdown by default", async () => {
    const { operations } = fakeOps([
      res({ headers: { "content-type": "text/html" }, body: "<h1>Title</h1>" }),
    ]);
    const tool = createWebFetchTool({ operations });
    const result = await tool.execute("t1", { url: "https://x.test" });
    expect(result.content[0]).toMatchObject({ type: "text", text: "# Title" });
  });

  it("extracts plain text when format=text", async () => {
    const { operations } = fakeOps([
      res({ headers: { "content-type": "text/html" }, body: "<p>Hello <b>world</b></p>" }),
    ]);
    const tool = createWebFetchTool({ operations });
    const result = await tool.execute("t1", { url: "https://x.test", format: "text" });
    expect(result.content[0]).toMatchObject({ type: "text", text: "Hello world" });
  });

  it("passes raw HTML through when format=html", async () => {
    const body = "<p>raw</p>";
    const { operations } = fakeOps([res({ headers: { "content-type": "text/html" }, body })]);
    const tool = createWebFetchTool({ operations });
    const result = await tool.execute("t1", { url: "https://x.test", format: "html" });
    expect(result.content[0]).toMatchObject({ type: "text", text: body });
  });

  it("passes non-HTML content through unchanged", async () => {
    const { operations } = fakeOps([
      res({ headers: { "content-type": "application/json" }, body: '{"a":1}' }),
    ]);
    const tool = createWebFetchTool({ operations });
    const result = await tool.execute("t1", { url: "https://x.test" });
    expect(result.content[0]).toMatchObject({ type: "text", text: '{"a":1}' });
  });
});

describe("webfetch MIME gating", () => {
  it("rejects image content types", async () => {
    const { operations } = fakeOps([res({ headers: { "content-type": "image/png" } })]);
    const tool = createWebFetchTool({ operations });
    await expect(tool.execute("t1", { url: "https://x.test" })).rejects.toThrow(
      "Unsupported fetched image content type: image/png",
    );
  });

  it("rejects non-textual content types", async () => {
    const { operations } = fakeOps([res({ headers: { "content-type": "application/zip" } })]);
    const tool = createWebFetchTool({ operations });
    await expect(tool.execute("t1", { url: "https://x.test" })).rejects.toThrow(
      "Unsupported fetched file content type: application/zip",
    );
  });
});

describe("webfetch Cloudflare fallback", () => {
  it("retries with the sakti UA on a 403 challenge", async () => {
    const { operations, calls } = fakeOps([
      res({
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
        body: "<html>blocked</html>",
      }),
      res({ status: 200, headers: { "content-type": "text/html" }, body: "<p>ok</p>" }),
    ]);
    const tool = createWebFetchTool({ operations });
    const result = await tool.execute("t1", { url: "https://x.test" });
    expect(result.content[0]).toMatchObject({ type: "text", text: "ok" });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.init.headers["User-Agent"]).toBe("sakti");
  });
});

describe("webfetch status gate", () => {
  it("throws on a non-2xx response", async () => {
    const { operations } = fakeOps([res({ status: 404, statusText: "Not Found" })]);
    const tool = createWebFetchTool({ operations });
    await expect(tool.execute("t1", { url: "https://x.test" })).rejects.toThrow(
      "HTTP 404 Not Found",
    );
  });
});

describe("webfetch timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out when the server does not respond", async () => {
    vi.useFakeTimers();
    const { operations } = fakeOps([], { hang: true });
    const tool = createWebFetchTool({ operations });
    const promise = tool.execute("t1", { url: "https://x.test" });
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(promise).rejects.toThrow("Request timed out");
  });
});

describe("webfetch success shape", () => {
  it("returns details with url, contentType, and format", async () => {
    const { operations } = fakeOps([
      res({ headers: { "content-type": "text/html; charset=utf-8" }, body: "<h1>Title</h1>" }),
    ]);
    const tool = createWebFetchTool({ operations });
    const result = await tool.execute("t1", { url: "https://x.test", format: "markdown" });
    expect(result.details).toMatchObject({
      url: "https://x.test/",
      contentType: "text/html; charset=utf-8",
      format: "markdown",
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/tools#test' -- --run src/webfetch/__tests__/webfetch.test.ts`
Expected: FAIL — `../index.ts` not found / `createWebFetchTool` not exported.

**Step 3: Write minimal implementation**

`packages/tools/src/webfetch/index.ts`:

```ts
import type { AgentTool } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { convertHTMLToMarkdown, extractTextFromHTML } from "../lib/html-convert.ts";
import { formatSize, truncateHead, type TruncationResult } from "../lib/truncate.ts";
import { collectBoundedBody } from "./bounded-body.ts";

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 120;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

type Format = "text" | "markdown" | "html";

const webfetchSchema = Type.Object({
  url: Type.String({ description: "The HTTP or HTTPS URL to fetch content from" }),
  format: Type.Optional(
    Type.Union([Type.Literal("text"), Type.Literal("markdown"), Type.Literal("html")], {
      description: "Format to return content in: text, markdown, or html. Defaults to markdown.",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: `Optional timeout in seconds (maximum: ${MAX_TIMEOUT_SECONDS}). Defaults to ${DEFAULT_TIMEOUT_SECONDS}.`,
    }),
  ),
});

export type WebFetchToolInput = Static<typeof webfetchSchema>;

export interface WebFetchToolDetails {
  url: string;
  contentType: string;
  format: Format;
  truncation?: TruncationResult;
}

export interface WebFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bytes: Uint8Array;
}

export interface WebFetchOperations {
  fetch: (
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
  ) => Promise<WebFetchResponse>;
}

export interface WebFetchToolOptions {
  operations?: WebFetchOperations;
  userAgent?: string;
}

function acceptHeader(format: Format): string {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
  }
}

function buildHeaders(format: Format, userAgent: string): Record<string, string> {
  return {
    "User-Agent": userAgent,
    Accept: acceptHeader(format),
    "Accept-Language": "en-US,en;q=0.9",
  };
}

function mimeFrom(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isImageAttachment(mime: string): boolean {
  return mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet";
}

function isTextualMime(mime: string): boolean {
  return (
    mime === "" ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime.endsWith("+json") ||
    mime === "application/xml" ||
    mime.endsWith("+xml") ||
    mime === "application/javascript" ||
    mime === "application/x-javascript"
  );
}

function convert(content: string, contentType: string, format: Format): string {
  if (!contentType.includes("text/html")) return content;
  if (format === "markdown") return convertHTMLToMarkdown(content);
  if (format === "text") return extractTextFromHTML(content);
  return content;
}

function isCloudflareChallenge(response: WebFetchResponse): boolean {
  return response.status === 403 && response.headers["cf-mitigated"] === "challenge";
}

function parseHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http:// or https://");
  }
  return url;
}

function clampTimeout(timeout: number | undefined): number {
  const value = timeout ?? DEFAULT_TIMEOUT_SECONDS;
  if (value < 1) return 1;
  if (value > MAX_TIMEOUT_SECONDS) return MAX_TIMEOUT_SECONDS;
  return value;
}

function withTimeout<T>(promise: Promise<T>, ms: number, controller: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Request timed out"));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export const defaultWebFetchOperations: WebFetchOperations = {
  async fetch(url, init) {
    const response = await fetch(url, init);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const bytes = response.body
      ? await collectBoundedBody(response.body, MAX_RESPONSE_BYTES)
      : new Uint8Array();
    return { status: response.status, statusText: response.statusText, headers, bytes };
  },
};

export function createWebFetchTool(
  options?: WebFetchToolOptions,
): AgentTool<typeof webfetchSchema, WebFetchToolDetails> {
  const operations = options?.operations ?? defaultWebFetchOperations;
  const userAgent = options?.userAgent ?? BROWSER_USER_AGENT;

  return {
    name: "webfetch",
    label: "webfetch",
    description: `Fetch content from an HTTP or HTTPS URL and return it as markdown (default), text, or HTML. Read-only. Validates the URL, caps the response at ${formatSize(MAX_RESPONSE_BYTES)}, and times out after ${DEFAULT_TIMEOUT_SECONDS}s by default (max ${MAX_TIMEOUT_SECONDS}s). Non-text content (e.g. images, binaries) is rejected. HTML is converted to markdown via Turndown; use format "text" for tag-stripped plain text or "html" for the raw page.`,
    parameters: webfetchSchema,
    permissions: (params) => [
      { permission: "webfetch", patterns: [(params as WebFetchToolInput).url] },
    ],
    async execute(_toolCallId, input, signal) {
      const format: Format = input.format ?? "markdown";
      const parsedUrl = parseHttpUrl(input.url);

      const controller = new AbortController();
      const onExternalAbort = (): void => controller.abort();
      if (signal) {
        if (signal.aborted) throw new Error("Operation aborted");
        signal.addEventListener("abort", onExternalAbort, { once: true });
      }

      const timeoutMs = clampTimeout(input.timeout) * 1000;

      try {
        const doFetch = (ua: string): Promise<WebFetchResponse> =>
          operations.fetch(parsedUrl.toString(), {
            headers: buildHeaders(format, ua),
            signal: controller.signal,
          });

        let response: WebFetchResponse;
        try {
          response = await withTimeout(doFetch(userAgent), timeoutMs, controller);
          if (isCloudflareChallenge(response)) {
            response = await withTimeout(doFetch("sakti"), timeoutMs, controller);
          }
        } catch (error) {
          if (signal?.aborted) throw new Error("Operation aborted");
          throw error;
        }

        if (response.status < 200 || response.status >= 300) {
          throw new Error(
            response.statusText
              ? `HTTP ${response.status} ${response.statusText}`
              : `HTTP ${response.status}`,
          );
        }

        const contentType = response.headers["content-type"] ?? "";
        const mime = mimeFrom(contentType);
        if (isImageAttachment(mime)) {
          throw new Error(`Unsupported fetched image content type: ${mime}`);
        }
        if (!isTextualMime(mime)) {
          throw new Error(`Unsupported fetched file content type: ${mime}`);
        }

        const decoded = new TextDecoder().decode(response.bytes);
        const output = convert(decoded, contentType, format);
        const truncation = truncateHead(output);

        const details: WebFetchToolDetails = {
          url: parsedUrl.toString(),
          contentType,
          format,
        };
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
      } finally {
        if (signal) signal.removeEventListener("abort", onExternalAbort);
      }
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/tools#test' -- --run src/webfetch/__tests__/webfetch.test.ts`
Expected: PASS (all webfetch tests).

**Step 5: Commit**

```bash
git add packages/tools/src/webfetch/index.ts packages/tools/src/webfetch/__tests__/webfetch.test.ts
git commit -m "feat(tools): add webfetch tool with size cap, timeout, and Cloudflare fallback"
```

---

### Task 5: Export the tool from the package barrel

**Files:**

- Modify: `packages/tools/src/index.ts`
- Test: `packages/tools/src/__tests__/permissions.test.ts` (add one case)

**Step 1: Re-export the public API**

In `packages/tools/src/index.ts`, add (anywhere among the existing exports):

```ts
export type {
  WebFetchOperations,
  WebFetchToolDetails,
  WebFetchToolInput,
  WebFetchToolOptions,
} from "./webfetch/index";
export { createWebFetchTool } from "./webfetch/index";
```

**Step 2: Add a permissions-declaration case to the existing suite**

In `packages/tools/src/__tests__/permissions.test.ts`:

- Add `createWebFetchTool` to the import from `"../index.ts"`.
- Add this test inside the `"tool permissions declarators"` describe:

```ts
it("webfetch declares webfetch + the url", () => {
  const tool = createWebFetchTool();
  expect(tool.permissions?.({ url: "https://example.com" })).toEqual([
    { permission: "webfetch", patterns: ["https://example.com"] },
  ]);
});
```

**Step 3: Run the package tests**

Run: `vp run '@sakti-code/tools#test'`
Expected: PASS — all suites green, including the new permissions case. No regressions in the existing 420 tests.

**Step 4: Commit**

```bash
git add packages/tools/src/index.ts packages/tools/src/__tests__/permissions.test.ts
git commit -m "feat(tools): export createWebFetchTool from the package barrel"
```

---

### Task 6: Wire the tool into the server

**Files:**

- Modify: `apps/server/src/agent/config/tool-registry.ts`
- Modify: `apps/server/src/agent/config/server-agents.ts`

**Step 1: Register the factory**

In `apps/server/src/agent/config/tool-registry.ts`:

- Add `createWebFetchTool` to the import from `"@sakti-code/tools"`.
- Add a factory entry to `TOOL_FACTORIES` (after `propose_session`):

```ts
  webfetch: () => createWebFetchTool() as AgentTool,
```

**Step 2: Enable the tool for agents**

In `apps/server/src/agent/config/server-agents.ts`:

- Add `"webfetch"` to `activeToolNames` of the **build**, **explore**, **general**, **plan**, and **intake** agents.
  - build: `["read", "write", "edit", "bash", "grep", "find", "webfetch"]`
  - explore: `["read", "grep", "find", "bash", "webfetch"]`
  - plan: `["read", "grep", "find", "bash", "webfetch"]`
  - general: `["read", "write", "edit", "bash", "grep", "find", "webfetch"]`
  - intake: `["read", "write", "edit", "bash", "grep", "find", "propose_session", "webfetch"]`

  > Rationale from the design: read-only network access benefits research-oriented agents. `plan` also gets it (research-before-plan) for consistency with explore. (Design called out build/general/intake/explore; adding plan too since it shares explore-like read-only research intent. If you'd rather keep plan minimal, drop it from plan only.)

**Step 3: Allow the permission in each ruleset**

Still in `server-agents.ts`, add `webfetch: "allow"` to every ruleset that currently has an explicit config, so the tool auto-allows regardless of the agent:

- `buildRuleset()`: add `webfetch: "allow",`
- `exploreRuleset()`: add `webfetch: "allow",` **after** `"*": "deny",` (last-match-wins permits it).
- `planRuleset()`: add `webfetch: "allow",`
- `intakeRuleset()`: add `webfetch: "allow",`
- `allowAllRuleset()` already covers it via `"*": "allow"` (general agent) — no change needed.

**Step 4: Typecheck the server**

Run: `vp run '@sakti-code/server#typecheck'` (or `vp check` at the end — see Task 7).
Expected: no type errors.

**Step 5: Commit**

```bash
git add apps/server/src/agent/config/tool-registry.ts apps/server/src/agent/config/server-agents.ts
git commit -m "feat(server): register webfetch tool and allow it in agent rulesets"
```

---

### Task 7: Full verification

**Step 1: Format, lint, typecheck**

Run: `vp check`
Expected: clean. If lint flags anything (e.g. import ordering), run `vp check --fix` and re-run.

**Step 2: Run all tests**

Run: `vp run -r test`
Expected: all packages green, including the new webfetch/bounded-body/html-convert suites and the updated permissions suite.

**Step 3: Manual smoke test (optional)**

Run: `vp run '@sakti-code/server#dev'` in one terminal, then exercise the tool via a session prompt that calls `webfetch` on a small public URL (e.g. `https://example.com`) and confirm it returns markdown. (Skip if no API keys configured.)

**Step 4: Final commit (only if verification touched files)**

If `vp check --fix` modified anything:

```bash
git add -A
git commit -m "style(tools): apply formatting to webfetch"
```

---

## Notes & risks

- **Timeout with fake ops:** the tool races `operations.fetch` against a timer via `withTimeout` AND aborts the `AbortController` on timeout. Default ops pass the signal to global `fetch`, so real network calls are cancelled; fake ops that ignore the signal still time out via the race. Tests use `vi.useFakeTimers()` + `advanceTimersByTimeAsync`.
- **Truncation vs. raw cap:** the 5 MiB cap bounds the raw HTTP body; `truncateHead` (default 50 KB) then bounds what the model sees. The full body is not retained (sakti has no managed-output store) — a deliberate divergence from opencode, matching sakti's inline-truncation model (grep/read).
- **`plan` agent:** the design named build/general/intake/explore; this plan also adds it to `plan` for consistency. Flagged in Task 6 Step 2 — easy to drop.
- **New runtime deps** (`turndown`, `htmlparser2`) are small and dependency-light; both verified working in plain Node (no jsdom).
- **Commit cadence:** one commit per task. Never commit without the user's explicit go-ahead during execution — stage and ask if unsure.
