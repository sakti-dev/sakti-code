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
