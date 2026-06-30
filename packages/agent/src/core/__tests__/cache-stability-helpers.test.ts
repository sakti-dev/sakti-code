import { describe, expect, it } from "vite-plus/test";
import {
  canonicalizeMessage,
  captureRequest,
  commonPrefixLength,
  measureCacheHit,
  type StreamRequestCapture,
} from "./cache-stability-helpers";

describe("commonPrefixLength", () => {
  it("returns the count of byte-identical leading items", () => {
    const a = ["x", "y", "z"];
    const b = ["x", "y", "w"];
    expect(commonPrefixLength(a, b, canonicalizeMessage)).toBe(2);
  });

  it("returns 0 when the first item differs", () => {
    expect(commonPrefixLength(["a"], ["b"], canonicalizeMessage)).toBe(0);
  });

  it("returns full length when one is a prefix of the other", () => {
    expect(commonPrefixLength(["a", "b"], ["a", "b", "c"], canonicalizeMessage)).toBe(2);
  });

  it("returns the shorter length when both are identical", () => {
    expect(commonPrefixLength(["a", "b"], ["a", "b"], canonicalizeMessage)).toBe(2);
  });
});

describe("measureCacheHit", () => {
  const baseCapture: StreamRequestCapture = {
    system: "prompt",
    messages: [{ role: "user", content: "hello" }],
    toolsKeys: ["read", "write"],
    toolsJson: '{"read":{}}',
  };

  it("returns prefixStable=true and hitChars>0 when only the tail grows", () => {
    const prev: StreamRequestCapture = baseCapture;
    const cur: StreamRequestCapture = {
      system: "prompt",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
      toolsKeys: ["read", "write"],
      toolsJson: '{"read":{}}',
    };
    const result = measureCacheHit(prev, cur);
    expect(result.prefixStable).toBe(true);
    expect(result.breakReason).toBeUndefined();
    expect(result.hitChars).toBeGreaterThan(0);
    expect(result.totalChars).toBeGreaterThan(result.hitChars);
    expect(result.hitRate).toBeGreaterThan(0);
    expect(result.hitRate).toBeLessThan(100);
  });

  it("detects a system prompt change as a prefix break", () => {
    const prev: StreamRequestCapture = {
      system: "prompt-a",
      messages: [{ role: "user", content: "hello" }],
      toolsKeys: [],
      toolsJson: "{}",
    };
    const cur: StreamRequestCapture = {
      system: "prompt-b",
      messages: [{ role: "user", content: "hello" }],
      toolsKeys: [],
      toolsJson: "{}",
    };
    const result = measureCacheHit(prev, cur);
    expect(result.prefixStable).toBe(false);
    expect(result.breakReason).toBe("system");
  });

  it("detects a tools change as a prefix break", () => {
    const prev: StreamRequestCapture = {
      system: "p",
      messages: [],
      toolsKeys: ["read"],
      toolsJson: '{"read":{}}',
    };
    const cur: StreamRequestCapture = {
      system: "p",
      messages: [],
      toolsKeys: ["read", "write"],
      toolsJson: '{"read":{},"write":{}}',
    };
    const result = measureCacheHit(prev, cur);
    expect(result.prefixStable).toBe(false);
    expect(result.breakReason).toBe("tools");
  });

  it("detects a changed earlier message as a prefix break", () => {
    const prev: StreamRequestCapture = {
      system: "p",
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
      toolsKeys: [],
      toolsJson: "{}",
    };
    const cur: StreamRequestCapture = {
      system: "p",
      messages: [
        { role: "user", content: "a-changed" },
        { role: "assistant", content: "b" },
      ],
      toolsKeys: [],
      toolsJson: "{}",
    };
    const result = measureCacheHit(prev, cur);
    expect(result.prefixStable).toBe(false);
    expect(result.breakReason).toBe("messages");
  });

  it("reports hitRate 100 when prev and cur are byte-identical (all prefix)", () => {
    const prev: StreamRequestCapture = {
      system: "p",
      messages: [{ role: "user", content: "hi" }],
      toolsKeys: [],
      toolsJson: "{}",
    };
    const cur: StreamRequestCapture = prev;
    expect(measureCacheHit(prev, cur).hitRate).toBe(100);
  });
});

describe("captureRequest", () => {
  it("captures system, messages, toolsKeys, and toolsJson from a StreamRequest", () => {
    const req = {
      model: { id: "m" },
      messages: [{ role: "user", content: "hi" }],
      system: "sysprompt",
      tools: { read: { description: "r" }, write: { description: "w" } },
    };
    const cap = captureRequest(req as never);
    expect(cap.system).toBe("sysprompt");
    expect(cap.messages).toHaveLength(1);
    expect(cap.toolsKeys).toEqual(["read", "write"]);
    expect(cap.toolsJson).toContain('"read"');
    expect(cap.toolsJson).toContain('"write"');
  });

  it("returns empty-string system and empty tools when absent", () => {
    const req = {
      model: { id: "m" },
      messages: [],
    };
    const cap = captureRequest(req as never);
    expect(cap.system).toBe("");
    expect(cap.toolsKeys).toEqual([]);
    expect(cap.toolsJson).toBe("{}");
  });
});
