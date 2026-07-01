import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
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
    async search(
      query: string,
      opts: { numResults: number; signal: AbortSignal },
    ): Promise<{ provider: string; results: typeof results }> {
      this.calls.push({ query, numResults: opts.numResults });
      if (behavior === "never") {
        return new Promise<{ provider: string; results: typeof results }>((_, reject) => {
          opts.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      if (behavior === "throw") throw new Error("boom");
      return { provider: "fake", results: behavior === "empty" ? [] : results };
    },
  };
}

describe("websearch tool", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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
    expect(out.content[0]).toMatchObject({ type: "text" });
    expect(out.content[0]).toHaveProperty(
      "text",
      expect.stringMatching(/1\. T1[\s\S]*https:\/\/a\.example/),
    );
    expect(out.details).toMatchObject({ provider: "fake", query: "q", count: 2 });
  });

  it("returns NO_RESULTS notice when empty", async () => {
    const tool = createWebSearchTool({ operations: fakeOps("empty") });
    const out = await tool.execute("c1", { query: "q" }, undefined!);
    expect(out.content[0]).toMatchObject({ type: "text", text: NO_RESULTS_NOTICE });
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

  it("throws an actionable error when no operations configured", async () => {
    const tool = createWebSearchTool();
    await expect(tool.execute("c1", { query: "q" }, undefined!)).rejects.toThrow(
      /not configured.*auth\.json/i,
    );
  });

  it("times out after the default timeout", async () => {
    const tool = createWebSearchTool({ operations: fakeOps("never") });
    const p = tool.execute("c1", { query: "q" }, undefined!);
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(25_000 + 50);
    await assertion;
  });

  it("aborts when the external signal is already aborted", async () => {
    const tool = createWebSearchTool({ operations: fakeOps() });
    const ac = new AbortController();
    ac.abort();
    await expect(tool.execute("c1", { query: "q" }, ac.signal)).rejects.toThrow(/aborted/i);
  });
});
