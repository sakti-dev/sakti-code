import { describe, expect, it } from "vite-plus/test";
import { buildSessionContextFromEntries } from "../../../session/session.ts";
import type {
  MessageEntry,
  ObservationPruneEntry,
  SessionTreeEntry,
} from "../../../session/entries.ts";
import type { AgentMessage } from "../../../types.ts";

function makeMsg(role: "user" | "assistant", content: string, timestamp: number): AgentMessage {
  if (role === "user") {
    return { role: "user", content, timestamp } as AgentMessage;
  }
  return {
    role: "assistant",
    content: [{ type: "text", text: content }],
    timestamp,
    model: "test",
    provider: "test",
    usage: {
      input: 0,
      output: 0,
      totalTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } as unknown as AgentMessage;
}

function makeMessageEntry(id: string, parentId: string | null, msg: AgentMessage): MessageEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date(msg.timestamp as number).toISOString(),
    message: msg,
  };
}

function makePruneEntry(
  id: string,
  parentId: string,
  observedEntryIds: string[],
  observationRecordId = "rec-1",
): ObservationPruneEntry {
  return {
    type: "observation_prune",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    observedEntryIds,
    observationRecordId,
  };
}

describe("buildSessionContextFromEntries — OM pruning", () => {
  it("filters observed messages when observation_prune entry exists", () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("m1", null, makeMsg("user", "old observed", 1)),
      makeMessageEntry("m2", "m1", makeMsg("assistant", "observed reply", 2)),
      makePruneEntry("prune1", "m2", ["m1", "m2"]),
      makeMessageEntry("m3", "prune1", makeMsg("user", "new unobserved", 3)),
    ];

    const ctx = buildSessionContextFromEntries(entries);
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0]).toMatchObject({ role: "user", content: "new unobserved" });
  });

  it("passes through all messages when no observation_prune entry", () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("m1", null, makeMsg("user", "hello", 1)),
      makeMessageEntry("m2", "m1", makeMsg("assistant", "hi", 2)),
    ];

    const ctx = buildSessionContextFromEntries(entries);
    expect(ctx.messages).toHaveLength(2);
  });

  it("uses the latest observation_prune entry when multiple exist", () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("m1", null, makeMsg("user", "first", 1)),
      makePruneEntry("p1", "m1", ["m1"]),
      makeMessageEntry("m2", "p1", makeMsg("user", "second", 2)),
      makePruneEntry("p2", "m2", ["m1", "m2"]),
      makeMessageEntry("m3", "p2", makeMsg("user", "third", 3)),
    ];

    const ctx = buildSessionContextFromEntries(entries);
    // Latest prune (p2) observes m1+m2, only m3 remains
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0]).toMatchObject({ content: "third" });
  });

  it("handles observation_prune with no matching messages gracefully", () => {
    const entries: SessionTreeEntry[] = [
      makeMessageEntry("m1", null, makeMsg("user", "hello", 1)),
      makePruneEntry("p1", "m1", ["nonexistent-id"]),
      makeMessageEntry("m2", "p1", makeMsg("user", "world", 2)),
    ];

    const ctx = buildSessionContextFromEntries(entries);
    expect(ctx.messages).toHaveLength(2);
  });
});
