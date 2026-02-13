import {
  getChatPerfSnapshot,
  recordChatPerfCounter,
  resetChatPerfTelemetry,
} from "@/core/chat/services/chat-perf-telemetry";
import { beforeEach, describe, expect, it } from "vitest";

describe("chat-perf-telemetry", () => {
  beforeEach(() => {
    resetChatPerfTelemetry();
  });

  it("records counters and exposes snapshot", () => {
    recordChatPerfCounter("sseEvents");
    recordChatPerfCounter("streamDataParts", 3);
    recordChatPerfCounter("turnProjectionMs", 2.5);
    recordChatPerfCounter("retryAttempts");
    recordChatPerfCounter("retryRecovered");
    recordChatPerfCounter("retryExhausted");

    const snapshot = getChatPerfSnapshot();
    expect(snapshot.counters.sseEvents).toBe(1);
    expect(snapshot.counters.streamDataParts).toBe(3);
    expect(snapshot.counters.turnProjectionMs).toBe(2.5);
    expect(snapshot.counters.retryAttempts).toBe(1);
    expect(snapshot.counters.retryRecovered).toBe(1);
    expect(snapshot.counters.retryExhausted).toBe(1);
  });
});
