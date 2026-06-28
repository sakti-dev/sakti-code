import type { AssistantMessage, Usage } from "@sakti-code/llm";
import { describe, expect, it } from "vitest";
import {
  type CheckCompactionInput,
  checkCompaction,
  parseCompactionSettings,
} from "../../compaction/auto-compaction";
import {
  type CompactionSettings,
  DEFAULT_COMPACTION_SETTINGS,
} from "../../compaction/compaction";

const usage = (over: Partial<Usage> = {}): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  ...over,
});

function asst(
  stopReason: AssistantMessage["stopReason"],
  over: Partial<AssistantMessage> = {}
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai",
    provider: "p",
    model: "m",
    usage: usage(),
    stopReason,
    timestamp: 100,
    ...over,
  } as AssistantMessage;
}

const baseInput = (
  message: AssistantMessage,
  over: Partial<CheckCompactionInput> = {}
): CheckCompactionInput => ({
  message,
  messages: [message],
  contextWindow: 1000,
  settings: DEFAULT_COMPACTION_SETTINGS, // reserve 16384
  ...over,
});

describe("parseCompactionSettings", () => {
  it("defaults to enabled with pi's defaults when unset", () => {
    const s = parseCompactionSettings({});
    expect(s).toEqual({
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
    });
  });

  it("resurrects the auto_compaction key as the enabled toggle (default true)", () => {
    expect(parseCompactionSettings({ auto_compaction: "false" }).enabled).toBe(
      false
    );
    expect(parseCompactionSettings({}).enabled).toBe(true);
  });

  it("parses reserve/keep overrides", () => {
    const s = parseCompactionSettings({
      compaction_reserve_tokens: "4096",
      compaction_keep_recent_tokens: "1000",
    });
    expect(s.reserveTokens).toBe(4096);
    expect(s.keepRecentTokens).toBe(1000);
  });
});

describe("checkCompaction", () => {
  const settings: CompactionSettings = {
    enabled: true,
    reserveTokens: 100,
    keepRecentTokens: 20_000,
  };

  it("returns none when compaction is disabled", () => {
    const d = checkCompaction(
      baseInput(asst("stop", { usage: usage({ totalTokens: 9999 }) }), {
        settings: { ...settings, enabled: false },
      })
    );
    expect(d.action).toBe("none");
  });

  it("returns none for an aborted turn", () => {
    const d = checkCompaction(baseInput(asst("aborted")));
    expect(d.action).toBe("none");
  });

  it("threshold: compacts when usage exceeds window minus reserve", () => {
    // contextWindow 1000, reserve 100 → threshold at 900.
    const d = checkCompaction(
      baseInput(asst("stop", { usage: usage({ totalTokens: 950 }) }), {
        settings,
      })
    );
    expect(d).toEqual({
      action: "compact",
      reason: "threshold",
      willRetry: false,
    });
  });

  it("threshold: no compaction when comfortably under window", () => {
    const d = checkCompaction(
      baseInput(asst("stop", { usage: usage({ totalTokens: 100 }) }), {
        settings,
      })
    );
    expect(d.action).toBe("none");
  });

  it("threshold: no compaction when contextWindow is unknown (0)", () => {
    const d = checkCompaction(
      baseInput(asst("stop", { usage: usage({ totalTokens: 99_999 }) }), {
        contextWindow: 0,
        settings,
      })
    );
    expect(d.action).toBe("none");
  });

  it("threshold: falls back to the local estimate when usage is empty (z.ai case)", () => {
    // Last assistant reports empty usage. estimateContextTokens then uses the
    // trailing-message estimate; here a large trailing user message pushes the
    // estimate over the threshold.
    const big = "x".repeat(4000); // 4000 chars / 4 = 1000 tokens > 900 threshold
    const message = asst("stop"); // empty usage
    const d = checkCompaction(
      baseInput(message, {
        messages: [message, { role: "user", content: big, timestamp: 200 }],
        settings,
      })
    );
    expect(d.action).toBe("compact");
    expect(d.reason).toBe("threshold");
  });

  it("threshold: empty usage with no trailing tokens stays none", () => {
    const message = asst("stop");
    const d = checkCompaction(
      baseInput(message, {
        messages: [message],
        settings,
      })
    );
    expect(d.action).toBe("none");
  });

  it("overflow: error message matching a pattern → compact + retry", () => {
    const d = checkCompaction(
      baseInput(asst("error", { errorMessage: "prompt is too long" }), {
        settings,
      })
    );
    expect(d).toEqual({
      action: "compact",
      reason: "overflow",
      willRetry: true,
    });
  });

  it("overflow: silent z.ai stop-overflow → compact WITHOUT retry", () => {
    // stopReason "stop" but input exceeds window — can't continue() from a
    // completed assistant message, so willRetry is false.
    const d = checkCompaction(
      baseInput(asst("stop", { usage: usage({ input: 2000 }) }), {
        settings,
      })
    );
    expect(d).toEqual({
      action: "compact",
      reason: "overflow",
      willRetry: false,
    });
  });

  it("stale-usage guard: skips when the message predates the latest compaction", () => {
    const d = checkCompaction(
      baseInput(
        asst("stop", { usage: usage({ totalTokens: 950 }), timestamp: 50 }),
        { settings, latestCompactionTimestamp: 100 }
      )
    );
    expect(d.action).toBe("none");
  });

  it("overflow takes precedence over threshold (both could match)", () => {
    const d = checkCompaction(
      baseInput(
        asst("error", {
          errorMessage: "prompt is too long",
          usage: usage({ totalTokens: 950 }),
        }),
        { settings }
      )
    );
    expect(d.reason).toBe("overflow");
  });
});

describe("stuck guard", () => {
  const settings: CompactionSettings = {
    enabled: true,
    reserveTokens: 100,
    keepRecentTokens: 100,
  };
  // contextWindow 1000, reserve 100 -> threshold at 900 tokens.

  it("does NOT pause when consecutiveCompacts is below 2 (still compacts)", () => {
    const message = asst("stop", {
      usage: usage({ totalTokens: 950 }),
      timestamp: 200,
    });
    const decision = checkCompaction(
      baseInput(message, {
        contextWindow: 1000,
        settings,
        consecutiveCompacts: 1,
      })
    );
    expect(decision.action).toBe("compact");
    expect(decision.reason).toBe("threshold");
    expect(decision.pauseAutoCompaction).toBeUndefined();
  });

  it("pauses auto-compaction when consecutiveCompacts >= 2 and prompt still over threshold", () => {
    const message = asst("stop", {
      usage: usage({ totalTokens: 950 }),
      timestamp: 200,
    });
    const decision = checkCompaction(
      baseInput(message, {
        contextWindow: 1000,
        settings,
        consecutiveCompacts: 2,
      })
    );
    expect(decision.action).toBe("none");
    expect(decision.pauseAutoCompaction).toBe(true);
    expect(decision.reason).toBe("stuck_guard");
  });

  it("resets the guard when prompt drops below threshold after prior compacts", () => {
    const message = asst("stop", {
      usage: usage({ totalTokens: 500 }),
      timestamp: 200,
    });
    const decision = checkCompaction(
      baseInput(message, {
        contextWindow: 1000,
        settings,
        consecutiveCompacts: 2, // was stuck, but now below threshold
      })
    );
    expect(decision.action).toBe("none");
    expect(decision.pauseAutoCompaction).toBeUndefined();
    expect(decision.resetStuckGuard).toBe(true);
  });

  it("does not signal reset when below threshold and counter was already 0", () => {
    const message = asst("stop", {
      usage: usage({ totalTokens: 500 }),
      timestamp: 200,
    });
    const decision = checkCompaction(
      baseInput(message, {
        contextWindow: 1000,
        settings,
      })
    );
    expect(decision.action).toBe("none");
    expect(decision.resetStuckGuard).toBeUndefined();
  });

  it("stuck guard does not fire on overflow path (overflow still compacts+retries)", () => {
    const message = asst("error", {
      errorMessage: "prompt is too long",
      timestamp: 200,
    });
    const decision = checkCompaction(
      baseInput(message, {
        contextWindow: 1000,
        settings,
        consecutiveCompacts: 5,
      })
    );
    expect(decision.action).toBe("compact");
    expect(decision.reason).toBe("overflow");
    expect(decision.pauseAutoCompaction).toBeUndefined();
  });
});
