import { describe, expect, it } from "vitest";
import { estimateContextTokens, shouldCompact } from "../compaction";
import type { AgentMessage } from "../types";

describe("shouldCompact", () => {
  it("returns true when tokens exceed contextWindow - reserveTokens", () => {
    expect(shouldCompact(190_000, 200_000, 16_000)).toBe(true);
  });

  it("returns false when within budget", () => {
    expect(shouldCompact(150_000, 200_000, 16_000)).toBe(false);
  });

  it("returns true exactly at boundary", () => {
    expect(shouldCompact(184_000, 200_000, 16_000)).toBe(true);
  });

  it("returns false one token under boundary", () => {
    expect(shouldCompact(183_999, 200_000, 16_000)).toBe(false);
  });
});

describe("estimateContextTokens", () => {
  const usage = (totalTokens: number) => ({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  });

  it("uses usage.totalTokens from the last assistant message (pi pattern)", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "x".repeat(4000), timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        timestamp: 2,
        usage: usage(12_345),
      },
    ];
    // No trailing messages → exactly the reported usage.
    expect(estimateContextTokens(messages)).toBe(12_345);
  });

  it("adds a char/4 estimate for messages after the last assistant", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        timestamp: 1,
        usage: usage(1000),
      },
      // 400 chars / 4 = 100 trailing tokens.
      { role: "user", content: "x".repeat(400), timestamp: 2 },
    ];
    expect(estimateContextTokens(messages)).toBe(1100);
  });

  it("falls back to char/4 over all messages when no assistant usage exists", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "x".repeat(800), timestamp: 1 },
      { role: "user", content: "x".repeat(400), timestamp: 2 },
    ];
    // 1200 chars / 4 = 300.
    expect(estimateContextTokens(messages)).toBe(300);
  });

  it("ignores an assistant message whose usage is zero and keeps scanning", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "x".repeat(800) }],
        timestamp: 1,
        usage: usage(0),
      },
      // 800 chars / 4 = 200 (no usable usage found anywhere → full fallback).
      { role: "user", content: "x".repeat(800), timestamp: 2 },
    ];
    // No usable usage → fallback over all messages = (800+800)/4 = 400.
    expect(estimateContextTokens(messages)).toBe(400);
  });

  it("skips error/aborted assistants and uses earlier usable usage (pi getAssistantUsage)", () => {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: "x".repeat(400),
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        timestamp: 2,
        usage: usage(500),
      },
      {
        role: "user",
        content: "prompt",
        timestamp: 3,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "billing exceeded" }],
        timestamp: 4,
        usage: usage(0),
        stopReason: "error",
        errorMessage: "billing",
      },
    ];
    // Most recent assistant is error (stopReason:'error', usage:0) → skip.
    // Next assistant has usage(500) → use it + trailing estimate.
    // Trailing: 1 user msg 'prompt' (6 chars) + error assistant content
    // 'billing exceeded' (16 chars) = 22 chars / 4 = 6 tokens.
    expect(estimateContextTokens(messages)).toBe(506);
  });

  it("skips aborted assistants and uses earlier usable usage", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        timestamp: 1,
        usage: usage(200),
      },
      {
        role: "user",
        content: "post",
        timestamp: 2,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        timestamp: 3,
        usage: usage(0),
        stopReason: "aborted",
      },
    ];
    // Aborted assistant skipped; earlier has usage(200) + trailing 'post' (4/4=1).
    expect(estimateContextTokens(messages)).toBe(201);
  });
});
