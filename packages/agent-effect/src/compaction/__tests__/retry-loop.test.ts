import type { AssistantMessage } from "@sakti-code/llm";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { CompactionDecision } from "~/compaction/auto-compaction";
import {
  abortableSleep,
  computeRetryDelay,
  executeWithRetry,
  executeWithRetryEffect,
  parseRetrySettings,
  type RetryRunnerDeps,
  type RetrySettings,
  shouldRetry,
} from "~/compaction/retry-loop";
import type { AgentEvent } from "~/types";

/** Build a minimal assistant message for retry tests. */
function assistantMessage(opts: {
  text?: string;
  stopReason?: AssistantMessage["stopReason"];
  errorMessage?: string;
}): AssistantMessage {
  return {
    api: "ai-sdk",
    content: [{ type: "text", text: opts.text ?? "" }],
    ...(opts.errorMessage === undefined
      ? {}
      : { errorMessage: opts.errorMessage }),
    model: "test-model",
    provider: "test",
    role: "assistant",
    stopReason: opts.stopReason ?? "stop",
    timestamp: Date.now(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

describe("shouldRetry", () => {
  const baseInput = {
    maxRetries: 3,
    autoRetryEnabled: true,
  };

  it("returns false when auto_retry is disabled", () => {
    expect(
      shouldRetry({
        ...baseInput,
        message: assistantMessage({
          stopReason: "error",
          errorMessage: "429 rate limited",
        }),
        attempt: 0,
        autoRetryEnabled: false,
      })
    ).toBe(false);
  });

  it("returns false for a non-retryable (billing) error", () => {
    expect(
      shouldRetry({
        ...baseInput,
        message: assistantMessage({
          stopReason: "error",
          errorMessage: "insufficient_quota",
        }),
        attempt: 0,
      })
    ).toBe(false);
  });

  it("returns false when the attempt budget is exhausted", () => {
    expect(
      shouldRetry({
        ...baseInput,
        message: assistantMessage({
          stopReason: "error",
          errorMessage: "429 rate limited",
        }),
        attempt: 3,
      })
    ).toBe(false);
  });

  it("returns true when retryable and budget remains", () => {
    expect(
      shouldRetry({
        ...baseInput,
        message: assistantMessage({
          stopReason: "error",
          errorMessage: "429 rate limited",
        }),
        attempt: 0,
      })
    ).toBe(true);
  });
});

describe("computeRetryDelay", () => {
  it("doubles the base delay per attempt (exponential backoff)", () => {
    expect(computeRetryDelay(1, 2000)).toBe(2000);
    expect(computeRetryDelay(2, 2000)).toBe(4000);
    expect(computeRetryDelay(3, 2000)).toBe(8000);
  });

  it("respects a non-default base delay", () => {
    expect(computeRetryDelay(1, 1000)).toBe(1000);
    expect(computeRetryDelay(2, 1000)).toBe(2000);
  });
});

describe("parseRetrySettings", () => {
  it("applies defaults when keys are missing", () => {
    expect(parseRetrySettings({})).toEqual<RetrySettings>({
      enabled: false,
      baseDelayMs: 2000,
      maxRetries: 3,
    });
  });

  it("parses explicit settings", () => {
    expect(
      parseRetrySettings({
        auto_retry: "true",
        base_delay_ms: "5000",
        max_retries: "5",
      })
    ).toEqual<RetrySettings>({
      enabled: true,
      baseDelayMs: 5000,
      maxRetries: 5,
    });
  });

  it("treats any non-'true' auto_retry value as disabled", () => {
    expect(parseRetrySettings({ auto_retry: "false" }).enabled).toBe(false);
    expect(parseRetrySettings({ auto_retry: "yes" }).enabled).toBe(false);
  });
});

describe("abortableSleep", () => {
  it("resolves true after the full delay when not aborted", async () => {
    const start = Date.now();
    const result = await abortableSleep(40, new AbortController().signal);
    expect(result).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  });

  it("resolves false immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await abortableSleep(1000, controller.signal);
    expect(result).toBe(false);
  });

  it("resolves false early when the signal aborts mid-sleep", async () => {
    const controller = new AbortController();
    const start = Date.now();
    const promise = abortableSleep(1000, controller.signal);
    setTimeout(() => controller.abort(), 30);
    const result = await promise;
    expect(result).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

/** Build fake deps for executeWithRetry, scripting runTurn responses in order.
 * Returns a holder so `rollbackCalls` can be read LIVE after the await
 * (primitives returned by value would snapshot at destructure time). */
function makeFakeDeps(opts: {
  turns: AssistantMessage[];
  signal: AbortSignal;
}): {
  deps: RetryRunnerDeps;
  emitCalls: AgentEvent[];
  rollbackCalls: number;
} {
  let turnIndex = 0;
  const emitCalls: AgentEvent[] = [];
  let rollbackCount = 0;
  return {
    deps: {
      signal: opts.signal,
      emit: (event) => emitCalls.push(event),
      rollbackLeaf: async () => {
        rollbackCount++;
      },
      runTurn: async () => {
        const message = opts.turns[turnIndex] ?? opts.turns.at(-1)!;
        turnIndex++;
        return message;
      },
    },
    emitCalls,
    // Getter reads the live counter — survives the await in the caller.
    get rollbackCalls() {
      return rollbackCount;
    },
  };
}

const enabledSettings: RetrySettings = {
  enabled: true,
  baseDelayMs: 1, // keep tests fast
  maxRetries: 3,
};

describe("executeWithRetry", () => {
  it("does nothing when the first turn succeeds (no retry events)", async () => {
    const fake = makeFakeDeps({
      signal: new AbortController().signal,
      turns: [assistantMessage({ text: "ok", stopReason: "stop" })],
    });
    await executeWithRetry(fake.deps, enabledSettings);
    expect(fake.emitCalls).toEqual([]);
    expect(fake.rollbackCalls).toBe(0);
  });

  it("retries once then succeeds, emitting start + end(success)", async () => {
    const fake = makeFakeDeps({
      signal: new AbortController().signal,
      turns: [
        assistantMessage({
          stopReason: "error",
          errorMessage: "429 rate limited",
        }),
        assistantMessage({ text: "ok", stopReason: "stop" }),
      ],
    });
    await executeWithRetry(fake.deps, enabledSettings);

    // One start (attempt 1) and one end (success, attempt 1).
    expect(fake.emitCalls.map((e) => e.type)).toEqual([
      "auto_retry_start",
      "auto_retry_end",
    ]);
    const start = fake.emitCalls[0]!;
    expect(start).toMatchObject({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      errorMessage: "429 rate limited",
    });
    const end = fake.emitCalls[1]!;
    expect(end).toMatchObject({
      type: "auto_retry_end",
      success: true,
      attempt: 1,
    });
    expect("finalError" in end).toBe(false);
    // Leaf rolled back once before the retry.
    expect(fake.rollbackCalls).toBe(1);
  });

  it("exhausts the budget and emits end(failure) with finalError", async () => {
    const fake = makeFakeDeps({
      signal: new AbortController().signal,
      turns: [
        assistantMessage({
          stopReason: "error",
          errorMessage: "503 overloaded",
        }),
        assistantMessage({
          stopReason: "error",
          errorMessage: "503 overloaded",
        }),
        assistantMessage({
          stopReason: "error",
          errorMessage: "503 overloaded",
        }),
        assistantMessage({
          stopReason: "error",
          errorMessage: "503 overloaded",
        }),
      ],
    });
    await executeWithRetry(fake.deps, enabledSettings);

    // 3 starts (attempts 1,2,3), then one failure end.
    expect(fake.emitCalls.map((e) => e.type)).toEqual([
      "auto_retry_start",
      "auto_retry_start",
      "auto_retry_start",
      "auto_retry_end",
    ]);
    const end = fake.emitCalls[3]!;
    expect(end).toMatchObject({
      type: "auto_retry_end",
      success: false,
      attempt: 3,
      finalError: "503 overloaded",
    });
    expect(fake.rollbackCalls).toBe(3);
  });

  it("does not retry when auto_retry is disabled", async () => {
    const fake = makeFakeDeps({
      signal: new AbortController().signal,
      turns: [
        assistantMessage({
          stopReason: "error",
          errorMessage: "429 rate limited",
        }),
      ],
    });
    await executeWithRetry(fake.deps, { ...enabledSettings, enabled: false });
    expect(fake.emitCalls).toEqual([]);
    expect(fake.rollbackCalls).toBe(0);
  });

  it("stops and emits end(failure) when aborted during the backoff sleep", async () => {
    const controller = new AbortController();
    // Force a long base delay so the sleep is interruptible.
    const longDelaySettings: RetrySettings = {
      enabled: true,
      baseDelayMs: 5000,
      maxRetries: 3,
    };
    const fake = makeFakeDeps({
      signal: controller.signal,
      turns: [
        assistantMessage({
          stopReason: "error",
          errorMessage: "429 rate limited",
        }),
      ],
    });
    // Abort shortly after the retry sleep starts.
    setTimeout(() => controller.abort(), 20);
    await executeWithRetry(fake.deps, longDelaySettings);

    expect(fake.emitCalls.map((e) => e.type)).toEqual([
      "auto_retry_start",
      "auto_retry_end",
    ]);
    const end = fake.emitCalls[1]!;
    expect(end).toMatchObject({
      type: "auto_retry_end",
      success: false,
      attempt: 1,
      finalError: "429 rate limited",
    });
    // runTurn was called once (the failing turn) but not a second time.
    expect(fake.rollbackCalls).toBe(1);
  });

  it("reports end(failure) when the retried turn is aborted mid-flight", async () => {
    // Regression guard: an aborted retried turn has stopReason "aborted"
    // (not "error"), so a `stopReason !== "error"` check alone would
    // mislabel it as success. The abort signal is authoritative.
    const controller = new AbortController();
    const emitCalls: AgentEvent[] = [];
    let turnIndex = 0;
    const turns: AssistantMessage[] = [
      assistantMessage({
        stopReason: "error",
        errorMessage: "429 rate limited",
      }),
      assistantMessage({ stopReason: "aborted" }),
    ];
    const deps: RetryRunnerDeps = {
      signal: controller.signal,
      emit: (event) => emitCalls.push(event),
      rollbackLeaf: async () => {},
      runTurn: async () => {
        const message = turns[turnIndex]!;
        turnIndex++;
        // Simulate the abort landing mid-turn: the retried turn returns an
        // "aborted" message and the signal is now aborted.
        if (turnIndex === 2) {
          controller.abort();
        }
        return message;
      },
    };
    await executeWithRetry(deps, enabledSettings);

    const end = emitCalls.at(-1)!;
    expect(end.type).toBe("auto_retry_end");
    // Aborted retries are NOT successes, even though stopReason is "aborted".
    expect(end).toMatchObject({ success: false, attempt: 1 });
  });
});

describe("executeWithRetry compaction phase", () => {
  /** Fake compaction deps: scripts decisions + tracks runCompaction calls. */
  function makeCompactionDeps(decisions: CompactionDecision[]) {
    let decisionIndex = 0;
    let runCalls = 0;
    return {
      checkCompaction: async (): Promise<CompactionDecision> => {
        const d = decisions[decisionIndex] ?? { action: "none" };
        decisionIndex++;
        return d;
      },
      runCompaction: async (): Promise<
        | {
            ok: true;
            summary: string;
            firstKeptEntryId: string;
            tokensBefore: number;
          }
        | { ok: false; errorMessage: string }
      > => {
        runCalls++;
        return {
          ok: true,
          summary: "summarized",
          firstKeptEntryId: "kept-1",
          tokensBefore: 5000,
        };
      },
      get runCompactionCalls() {
        return runCalls;
      },
    };
  }

  it("runs no compaction when the deps are absent (back-compat)", async () => {
    const fake = makeFakeDeps({
      signal: new AbortController().signal,
      turns: [assistantMessage({ text: "ok" })],
    });
    await executeWithRetry(fake.deps, enabledSettings);
    expect(fake.emitCalls.some((e) => e.type === "compaction_start")).toBe(
      false
    );
  });

  it("emits compaction_start/end and runs compaction when the threshold is hit", async () => {
    const fake = makeFakeDeps({
      signal: new AbortController().signal,
      turns: [assistantMessage({ text: "ok" })],
    });
    const comp = makeCompactionDeps([
      { action: "compact", reason: "threshold", willRetry: false },
    ]);
    await executeWithRetry(
      {
        ...fake.deps,
        checkCompaction: comp.checkCompaction,
        runCompaction: comp.runCompaction,
      },
      enabledSettings
    );

    expect(comp.runCompactionCalls).toBe(1);
    const start = fake.emitCalls.find((e) => e.type === "compaction_start");
    const end = fake.emitCalls.find((e) => e.type === "compaction_end");
    expect(start).toMatchObject({
      type: "compaction_start",
      reason: "threshold",
    });
    expect(end).toMatchObject({
      type: "compaction_end",
      reason: "threshold",
      willRetry: false,
      aborted: false,
    });
    expect((end as { result?: unknown }).result).toMatchObject({
      summary: "summarized",
      firstKeptEntryId: "kept-1",
      tokensBefore: 5000,
    });
  });

  it("does not retry the turn when willRetry is false (threshold)", async () => {
    let turnCalls = 0;
    const deps: RetryRunnerDeps = {
      signal: new AbortController().signal,
      emit: () => {},
      rollbackLeaf: async () => {},
      runTurn: async () => {
        turnCalls++;
        return assistantMessage({ text: "ok" });
      },
      checkCompaction: async () => ({
        action: "compact",
        reason: "threshold",
        willRetry: false,
      }),
      runCompaction: async () => ({
        ok: true,
        summary: "s",
        firstKeptEntryId: "k",
        tokensBefore: 1,
      }),
    };
    await executeWithRetry(deps, enabledSettings);
    expect(turnCalls).toBe(1); // no continue() after a threshold compaction
  });

  it("retries the turn once after an overflow compaction (willRetry)", async () => {
    let turnCalls = 0;
    const decisions: CompactionDecision[] = [
      { action: "compact", reason: "overflow", willRetry: true },
      { action: "none" }, // the retried turn no longer overflows
    ];
    let decisionIndex = 0;
    const deps: RetryRunnerDeps = {
      signal: new AbortController().signal,
      emit: () => {},
      rollbackLeaf: async () => {},
      runTurn: async () => {
        turnCalls++;
        return assistantMessage({ text: "ok" });
      },
      checkCompaction: async () =>
        decisions[decisionIndex++] ?? { action: "none" },
      runCompaction: async () => ({
        ok: true,
        summary: "s",
        firstKeptEntryId: "k",
        tokensBefore: 1,
      }),
    };
    await executeWithRetry(deps, enabledSettings);
    expect(turnCalls).toBe(2); // initial turn + one continue()
  });

  it("caps overflow recovery at one compact-and-retry", async () => {
    let turnCalls = 0;
    // Every check keeps requesting an overflow retry — only one is allowed.
    const deps: RetryRunnerDeps = {
      signal: new AbortController().signal,
      emit: () => {},
      rollbackLeaf: async () => {},
      runTurn: async () => {
        turnCalls++;
        return assistantMessage({ text: "ok" });
      },
      checkCompaction: async () => ({
        action: "compact",
        reason: "overflow",
        willRetry: true,
      }),
      runCompaction: async () => ({
        ok: true,
        summary: "s",
        firstKeptEntryId: "k",
        tokensBefore: 1,
      }),
    };
    await executeWithRetry(deps, enabledSettings);
    // initial + exactly one recovery retry, then the second overflow gives up.
    expect(turnCalls).toBe(2);
  });

  it("emits an error compaction_end (no retry) when runCompaction fails", async () => {
    const fake = makeFakeDeps({
      signal: new AbortController().signal,
      turns: [assistantMessage({ text: "ok" })],
    });
    const deps: RetryRunnerDeps = {
      ...fake.deps,
      checkCompaction: async () => ({
        action: "compact",
        reason: "threshold",
        willRetry: false,
      }),
      runCompaction: async () => ({ ok: false, errorMessage: "boom" }),
    };
    await executeWithRetry(deps, enabledSettings);
    const end = fake.emitCalls.find((e) => e.type === "compaction_end");
    expect(end).toMatchObject({
      type: "compaction_end",
      willRetry: false,
      errorMessage: "boom",
    });
    expect((end as { result?: unknown }).result).toBeUndefined();
  });
});

describe("executeWithRetryEffect", () => {
  it("returns an Effect (not a Promise)", () => {
    const fake = makeFakeDeps({
      signal: new AbortController().signal,
      turns: [assistantMessage({ text: "ok", stopReason: "stop" })],
    });
    const effect = executeWithRetryEffect(fake.deps, enabledSettings);
    expect(Effect.isEffect(effect)).toBe(true);
  });

  it("runs via Effect.runPromise with same semantics as executeWithRetry", async () => {
    const fake = makeFakeDeps({
      signal: new AbortController().signal,
      turns: [
        assistantMessage({
          stopReason: "error",
          errorMessage: "429 rate limited",
        }),
        assistantMessage({ text: "ok", stopReason: "stop" }),
      ],
    });
    await Effect.runPromise(executeWithRetryEffect(fake.deps, enabledSettings));

    expect(fake.emitCalls.map((e) => e.type)).toEqual([
      "auto_retry_start",
      "auto_retry_end",
    ]);
    expect(fake.rollbackCalls).toBe(1);
    const end = fake.emitCalls[1] as { success: boolean; attempt: number };
    expect(end.success).toBe(true);
    expect(end.attempt).toBe(1);
  });

  it("composes inside another Effect.gen", async () => {
    const fake = makeFakeDeps({
      signal: new AbortController().signal,
      turns: [assistantMessage({ text: "ok", stopReason: "stop" })],
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* executeWithRetryEffect(fake.deps, enabledSettings);
        return "done";
      })
    );
    expect(result).toBe("done");
    expect(fake.emitCalls).toEqual([]);
  });
});
