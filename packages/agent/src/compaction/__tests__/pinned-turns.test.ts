import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../types";
import {
  DEFAULT_MAX_PINNED_USER_TOKENS,
  isPinnableUserTurn,
  partitionPinnedTurns,
} from "../pinned-turns";

function userMsg(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: 1,
  };
}

function asstMsg(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

describe("isPinnableUserTurn", () => {
  it("returns true for a small user turn", () => {
    expect(
      isPinnableUserTurn(userMsg("remember: use pnpm"), { maxTokens: 1500 })
    ).toBe(true);
  });

  it("returns false for a large user turn (over the token budget)", () => {
    const big = "x".repeat(1500 * 4 + 100); // > 1500 tokens at 4 chars/token
    expect(isPinnableUserTurn(userMsg(big), { maxTokens: 1500 })).toBe(false);
  });

  it("returns false for a non-user message", () => {
    expect(
      isPinnableUserTurn(asstMsg("assistant text"), { maxTokens: 1500 })
    ).toBe(false);
  });

  it("uses DEFAULT_MAX_PINNED_USER_TOKENS when no options given", () => {
    expect(isPinnableUserTurn(userMsg("small"))).toBe(true);
    expect(DEFAULT_MAX_PINNED_USER_TOKENS).toBe(1500);
  });
});

describe("partitionPinnedTurns", () => {
  it("separates small user turns into pinned, rest into foldable", () => {
    const messages: AgentMessage[] = [
      userMsg("use pnpm always"),
      asstMsg("ok"),
      userMsg("now do X"),
      asstMsg("doing X"),
    ];
    const { pinned, foldable } = partitionPinnedTurns(messages, {
      maxTokens: 1500,
    });
    expect(pinned).toHaveLength(2);
    expect(foldable).toHaveLength(2);
    expect(pinned[0]).toBe(messages[0]);
    expect(foldable[0]).toBe(messages[1]);
  });

  it("returns all-foldable when no user turns are small enough", () => {
    const big = "x".repeat(8000);
    const messages: AgentMessage[] = [userMsg(big), asstMsg("ok")];
    const { pinned, foldable } = partitionPinnedTurns(messages, {
      maxTokens: 1500,
    });
    expect(pinned).toHaveLength(0);
    expect(foldable).toHaveLength(2);
  });

  it("preserves relative order within pinned and foldable", () => {
    const messages: AgentMessage[] = [
      userMsg("first pin"),
      asstMsg("fold 1"),
      userMsg("second pin"),
      asstMsg("fold 2"),
    ];
    const { pinned, foldable } = partitionPinnedTurns(messages);
    const text = (m: AgentMessage) =>
      (m as { content: Array<{ text: string }> }).content[0]!.text;
    expect(pinned.map(text)).toEqual(["first pin", "second pin"]);
    expect(foldable.map(text)).toEqual(["fold 1", "fold 2"]);
  });
});
