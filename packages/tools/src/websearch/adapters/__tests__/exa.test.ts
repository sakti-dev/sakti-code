import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { buildExaOperations, EXA_MCP_URL } from "../exa";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("exa adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends a JSON-RPC tools/call to the Exa MCP url with the key as a query param", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      jsonResponse({ result: { content: [{ type: "text", text: "[]" }] } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await buildExaOperations("exa-key").search("rust async", {
      numResults: 5,
      signal: new AbortController().signal,
    });
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
  });

  it("maps a direct JSON result.content text payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
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
      ),
    );
    const out = await buildExaOperations("k").search("q", {
      numResults: 3,
      signal: new AbortController().signal,
    });
    expect(out.provider).toBe("exa");
    expect(out.results).toEqual([{ title: "A", url: "https://a", snippet: "snip" }]);
  });

  it("falls back to parsing a data: SSE line", async () => {
    const line = `data: ${JSON.stringify({
      result: { content: [{ type: "text", text: '[{"title":"B","url":"https://b","text":"x"}]' }] },
    })}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`event: message\n${line}\n\n`, { status: 200 })),
    );
    const out = await buildExaOperations("k").search("q", {
      numResults: 3,
      signal: new AbortController().signal,
    });
    expect(out.results).toEqual([{ title: "B", url: "https://b", snippet: "x" }]);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    await expect(
      buildExaOperations("k").search("q", { numResults: 3, signal: new AbortController().signal }),
    ).rejects.toThrow(/Exa HTTP 500/);
  });
});
