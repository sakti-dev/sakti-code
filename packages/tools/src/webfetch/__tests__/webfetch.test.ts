import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createWebFetchTool, type WebFetchOperations, type WebFetchResponse } from "../index.ts";

function res(
  opts: Partial<WebFetchResponse> & { status?: number; body?: string },
): WebFetchResponse {
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
      if (hang) {
        return new Promise<WebFetchResponse>((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      const r = responses[Math.min(i, responses.length - 1)]!;
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
    const assertion = expect(promise).rejects.toThrow("Request timed out");
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
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
