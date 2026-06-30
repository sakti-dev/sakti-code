import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { buildTavilyOperations, TAVILY_URL } from "../tavily";

describe("tavily adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs with Bearer auth and query/max_results/include_answer", async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as Record<string, unknown>;
      expect(init!.headers).toMatchObject({ Authorization: "Bearer tv-key" });
      expect(body).toMatchObject({ query: "q", max_results: 5, include_answer: false });
      return new Response(
        JSON.stringify({ results: [{ title: "A", url: "https://a", content: "snip" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await buildTavilyOperations("tv-key").search("q", {
      numResults: 5,
      signal: new AbortController().signal,
    });
    expect(String(fetchMock.mock.calls[0]![0])).toContain(TAVILY_URL);
    expect(out.provider).toBe("tavily");
    expect(out.results).toEqual([{ title: "A", url: "https://a", snippet: "snip" }]);
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    await expect(
      buildTavilyOperations("k").search("q", {
        numResults: 3,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/Tavily HTTP 401/);
  });
});
