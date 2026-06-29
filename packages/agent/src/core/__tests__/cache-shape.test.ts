import type { StreamRequest, Usage } from "@sakti-code/llm";
import { describe, expect, it } from "vite-plus/test";
import { captureShape, compareShape } from "../cache-shape";

function req(over: Partial<StreamRequest> = {}): StreamRequest {
  return {
    model: { id: "m" },
    messages: [],
    ...over,
  } as StreamRequest;
}

const usage = (cacheRead = 0, cacheWrite = 0): Usage => ({
  input: 100,
  output: 50,
  cacheRead,
  cacheWrite,
  totalTokens: 100 + 50 + cacheRead + cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

describe("captureShape", () => {
  it("hashes system + tools into a stable PrefixShape", () => {
    const shape = captureShape(
      req({ system: "prompt", tools: { read: { description: "r" } } })
    );
    expect(shape.systemHash).toMatch(/^[0-9a-f]{8}$/);
    expect(shape.toolsHash).toMatch(/^[0-9a-f]{8}$/);
    expect(shape.prefixHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces identical hashes for identical inputs", () => {
    const a = captureShape(req({ system: "p", tools: { a: {} } }));
    const b = captureShape(req({ system: "p", tools: { a: {} } }));
    expect(a).toEqual(b);
  });

  it("changes systemHash when system prompt changes", () => {
    const a = captureShape(req({ system: "p1" }));
    const b = captureShape(req({ system: "p2" }));
    expect(a.systemHash).not.toBe(b.systemHash);
  });
});

describe("compareShape", () => {
  it("reports no changes when shapes are identical", () => {
    const shape = captureShape(req({ system: "p", tools: { a: {} } }));
    const d = compareShape(shape, shape, usage(500, 100));
    expect(d.changed).toBe(false);
    expect(d.changeReasons).toEqual([]);
    expect(d.cacheHitTokens).toBe(500);
    expect(d.cacheMissTokens).toBe(100);
  });

  it("reports 'system' when systemHash differs", () => {
    const prev = captureShape(req({ system: "p1" }));
    const cur = captureShape(req({ system: "p2" }));
    const d = compareShape(prev, cur, usage());
    expect(d.changed).toBe(true);
    expect(d.changeReasons).toContain("system");
  });

  it("reports 'tools' when toolsHash differs", () => {
    const prev = captureShape(req({ tools: { a: {} } }));
    const cur = captureShape(req({ tools: { a: {}, b: {} } }));
    const d = compareShape(prev, cur, usage());
    expect(d.changed).toBe(true);
    expect(d.changeReasons).toContain("tools");
  });

  it("treats first-ever turn (prev undefined) as unchanged baseline", () => {
    const cur = captureShape(req({ system: "p" }));
    const d = compareShape(undefined, cur, usage(0, 500));
    expect(d.changed).toBe(false);
    expect(d.changeReasons).toEqual([]);
  });
});
