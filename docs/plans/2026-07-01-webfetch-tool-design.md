# Design: `webfetch` tool

**Date:** 2026-07-01
**Status:** Approved
**Scope:** Port opencode's `webfetch` builtin into sakti's `@sakti-code/tools`, adapted to plain-TS + Node conventions.

## Goal

Give sakti agents a read-only tool to fetch an HTTP(S) URL and return its content as markdown (default), text, or HTML. Faithful behavioral port of opencode's `webfetch`; runtime and permission wiring follow sakti conventions.

## Non-goals

- Image fetching / returning `ImageContent` (opencode rejects images; this port does too).
- `websearch` (separate future tool).
- Streaming incremental updates (`onUpdate` unused; runs to completion like opencode).

## Decisions (from brainstorming)

| Decision           | Choice                                                                      |
| ------------------ | --------------------------------------------------------------------------- |
| Fidelity           | Faithful port of opencode behavior                                          |
| Permission default | Allow-by-default; add to build, general, intake, explore                    |
| Structure          | Approach A — `WebFetchOperations` DI seam; pure converters in `lib/`        |
| HTTP client        | Node global `fetch` (built-in Node 18+ / Electron)                          |
| HTML libs          | `turndown ^7` + `htmlparser2 ^9` (verified working in plain Node; no jsdom) |

## Components

- `packages/tools/src/webfetch/index.ts` — tool factory, schema, operations seam.
- `packages/tools/src/lib/html-convert.ts` — pure `convertHTMLToMarkdown` / `extractTextFromHTML`.
- `packages/tools/src/webfetch/__tests__/` — tool tests (fake `fetch` op, no network).
- `packages/tools/src/lib/__tests__/html-convert.test.ts` — converter unit tests.
- Re-export from `packages/tools/src/index.ts`.

## Schema (TypeBox)

```
url:     string          // validated via new URL(); protocol must be http/https
format:  optional enum { "text" | "markdown" | "html" }, default "markdown"
timeout: optional number, 1..120 seconds, default 30
```

`WebFetchToolDetails = { url: string; contentType: string; format: Format; truncated?: boolean }`

## Operations seam

```ts
interface WebFetchOperations {
  fetch(
    url: string,
    init: { headers: Record<string, string>; signal: AbortSignal },
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    bytes: Uint8Array;
  }>;
}
```

`defaultWebFetchOperations`:

- Uses global `fetch`.
- Streams the body, accumulating bytes up to `MAX_RESPONSE_BYTES` (5 MiB); aborts and throws `Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)` on overflow.
- No timeout here — timeout is owned by the caller via `AbortController` (see behavior step 3).

Tests inject a fake `fetch` returning canned `{ status, headers, bytes }`.

## Constants

```
MAX_RESPONSE_BYTES    = 5 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 30
MAX_TIMEOUT_SECONDS   = 120
BROWSER_USER_AGENT    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
```

## Behavior

1. **Validate URL**: `new URL(url)`; protocol must be `http:` or `https:`. Else throw `URL must use http:// or https://`.
2. **Headers**: browser UA; `Accept` per format:
   - markdown: `text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1`
   - text: `text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1`
   - html: `text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1`
   - plus `Accept-Language: en-US,en;q=0.9`.
3. **Timeout**: clamp `timeout ?? DEFAULT_TIMEOUT_SECONDS` to `[1, MAX_TIMEOUT_SECONDS]`; run under an `AbortController` that fires after N seconds → throw `Request timed out`.
4. **Cloudflare fallback**: if response is `403` and `cf-mitigated: challenge` header is present, retry once with UA `"sakti"`.
5. **Status gate**: non-2xx → throw `HTTP <status> <statusText>` (empty statusText → `HTTP <status>`).
6. **MIME gating** (from `Content-Type`, charset-stripped):
   - Reject `image/*` except `image/svg+xml` (and `image/vnd.fastbidsheet`) → `Unsupported fetched image content type: <mime>`.
   - Reject non-textual MIME. Allowed: empty, `text/*`, `application/json`, `+json`, `application/xml`, `+xml`, `application/javascript`, `application/x-javascript`. Else `Unsupported fetched file content type: <mime>`.
7. **Convert** by format. Conversion only happens when `Content-Type` includes `text/html`; otherwise the raw decoded text passes through.
   - markdown → `convertHTMLToMarkdown`
   - text → `extractTextFromHTML`
   - html → passthrough
8. **Truncate** converted output with `truncateHead()`; if truncated, append notice line and set `details.truncated = true`.
9. **Return** `{ content: [{ type: "text", text }], details: { url, contentType, format, truncated? } }`.

## Pure converters (`lib/html-convert.ts`)

- `convertHTMLToMarkdown(html)`: `new TurndownService({ headingStyle: "atx", hr: "---", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*" })`, then `turndown.remove(["script", "style", "meta", "link"])` so script bodies don't leak into output.
- `extractTextFromHTML(html)`: htmlparser2 `Parser` that skips `script`, `style`, `noscript`, `iframe`, `object`, `embed` (depth counter) and accumulates `ontext`; returns trimmed text.

## Permissions & wiring

- Tool: `permissions: (params) => [{ permission: "webfetch", patterns: [(params as WebFetchToolInput).url] }]`.
- `apps/server/src/agent/config/tool-registry.ts`: add `webfetch: () => createWebFetchTool() as AgentTool` to `TOOL_FACTORIES` (no cwd).
- `apps/server/src/agent/config/server-agents.ts`:
  - Add `"webfetch"` to `activeToolNames` of **build, general, intake, explore**.
  - Add `webfetch: "allow"` to build, general, intake, explore rulesets. (Explore: place after `"*": "deny"` so last-match-wins permits it — `fromConfig` is insertion-ordered, `evaluate` is last-match-wins.)

## Error handling

Throw `Error` objects (sakti convention). The agent runner surfaces thrown errors as failed tool results; no opencode `ToolFailure`. All user-facing messages are static strings; never interpolate untrusted response bodies into messages.

## Testing (TDD)

RED first, then GREEN. Suites:

1. **`lib/html-convert.test.ts`** (pure):
   - markdown: heading → atx, bold, fenced code; `<script>` body stripped.
   - text: tags stripped, `script/style/noscript/iframe` content excluded, whitespace trimmed.
2. **`webfetch/__tests__/index.test.ts`** (fake ops):
   - URL validation: non-http(s) protocol, malformed URL.
   - Format dispatch: markdown/text/html each produce expected conversion; non-html content-type passes through unchanged.
   - Size cap: body > 5MB throws `Response too large`.
   - Timeout: ops that never resolves → `Request timed out` (fake timers).
   - Image MIME rejection; non-text MIME rejection.
   - Cloudflare fallback: first response `403` + `cf-mitigated: challenge`, second succeeds → returns second body, UA changed on retry.
   - Non-2xx → `HTTP <status>` error.
   - Success: 2xx, `text/html`, format markdown → turndown output; details shape correct.
   - Permission declaration: `permissions({ url: "https://x" })` returns `[{ permission: "webfetch", patterns: ["https://x"] }]`.
   - `timeout` clamp: 0 and 200 both accepted without throwing at the validation layer (clamped).

## Dependencies

Add to `packages/tools/package.json`:

- `turndown: ^7.2.0`
- `htmlparser2: ^9.1.0`

## Open questions / risks

- Turndown and htmlparser2 are new runtime deps for `@sakti-code/tools`; both are small, dependency-light, and widely used. Acceptable per the faithful-port decision.
- The 5MB raw cap plus `truncateHead()` (default 50KB) means the model sees at most ~50KB of converted text even if the page is large; the full body is not retained (no managed storage in sakti's runner). This diverges from opencode's managed-retention path but matches sakti's inline-truncation model used by grep/read.
