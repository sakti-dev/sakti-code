import { describe, expect, it } from "vite-plus/test";
import { buildSessionContextFromEntries } from "../session";
import type { SessionTreeEntry } from "../entries";

const ts = (n: number) => new Date(`2026-07-07T00:00:0${n}Z`).toISOString();

describe("buildSessionContextFromEntries — observation/reflection entries", () => {
  it("renders ObservationEntry as an observation message in the stream", () => {
    const entries: SessionTreeEntry[] = [
      {
        id: "u1",
        parentId: null,
        timestamp: ts(0),
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      },
      {
        id: "o1",
        parentId: "u1",
        timestamp: ts(1),
        type: "observation",
        summary: "* User likes TS",
        observationRecordId: "om-1",
      },
    ];
    const ctx = buildSessionContextFromEntries(entries);
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[1]!.role).toBe("observation");
    expect((ctx.messages[1] as { summary: string }).summary).toContain("User likes TS");
  });

  it("renders ReflectionEntry as a reflection message", () => {
    const entries: SessionTreeEntry[] = [
      {
        id: "u1",
        parentId: null,
        timestamp: ts(0),
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      },
      {
        id: "r1",
        parentId: "u1",
        timestamp: ts(2),
        type: "reflection",
        summary: "condensed",
        observationRecordId: "om-1",
      },
    ];
    const ctx = buildSessionContextFromEntries(entries);
    expect(ctx.messages[1]!.role).toBe("reflection");
  });

  it("observation_prune still skips observed message entries; observation entry renders", () => {
    const entries: SessionTreeEntry[] = [
      {
        id: "u1",
        parentId: null,
        timestamp: ts(0),
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      },
      {
        id: "m1",
        parentId: "u1",
        timestamp: ts(1),
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "resp" }], timestamp: 2 },
      },
      {
        id: "o1",
        parentId: "m1",
        timestamp: ts(2),
        type: "observation",
        summary: "obs",
        observationRecordId: "om-1",
      },
      {
        id: "p1",
        parentId: "o1",
        timestamp: ts(3),
        type: "observation_prune",
        observedEntryIds: ["m1"],
        observationRecordId: "om-1",
      },
    ];
    const ctx = buildSessionContextFromEntries(entries);
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0]!.role).toBe("user");
    expect(ctx.messages[1]!.role).toBe("observation");
  });
});
