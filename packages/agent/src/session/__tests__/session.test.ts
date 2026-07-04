import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  createAssistantMessage,
  createTestSession,
  createUserMessage,
} from "../../session/__tests__/session-test-utils";

describe("Session with in-memory storage", () => {
  it("appends messages and builds context in order", async () => {
    const session = await createTestSession();
    await Effect.runPromise(session.appendMessage(createUserMessage("one")));
    await Effect.runPromise(session.appendMessage(createAssistantMessage("two")));
    const context = await Effect.runPromise(session.buildContext());
    expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("tracks model and thinking level changes", async () => {
    const session = await createTestSession();
    await Effect.runPromise(session.appendMessage(createUserMessage("one")));
    await Effect.runPromise(session.appendModelChange("openai", "gpt-4.1"));
    await Effect.runPromise(session.appendThinkingLevelChange("high"));
    const context = await Effect.runPromise(session.buildContext());
    expect(context.thinkingLevel).toBe("high");
    expect(context.model).toEqual({ provider: "openai", modelId: "gpt-4.1" });
  });

  it("supports branching by moving the leaf and appending a new branch", async () => {
    const session = await createTestSession();
    const user1 = await Effect.runPromise(session.appendMessage(createUserMessage("one")));
    const assistant1 = await Effect.runPromise(
      session.appendMessage(createAssistantMessage("two")),
    );
    await Effect.runPromise(session.appendMessage(createUserMessage("three")));
    await Effect.runPromise(session.moveTo(user1));
    await Effect.runPromise(session.appendMessage(createAssistantMessage("branched")));
    const branch = await Effect.runPromise(session.getBranch());
    expect(branch.map((entry) => entry.id)).toContain(user1);
    expect(branch.map((entry) => entry.id)).not.toContain(assistant1);
    const context = await Effect.runPromise(session.buildContext());
    expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("supports moving the leaf to root", async () => {
    const session = await createTestSession();
    await Effect.runPromise(session.appendMessage(createUserMessage("one")));
    await Effect.runPromise(session.moveTo(null));
    expect(await Effect.runPromise(session.getLeafId())).toBeNull();
    expect((await Effect.runPromise(session.buildContext())).messages).toEqual([]);
  });

  it("supports moving with branch summary entries in context", async () => {
    const session = await createTestSession();
    const user1 = await Effect.runPromise(session.appendMessage(createUserMessage("one")));
    const summaryId = await Effect.runPromise(session.moveTo(user1, { summary: "summary text" }));
    expect(summaryId).toBeTruthy();
    const summaryEntry = await Effect.runPromise(session.getEntry(summaryId!));
    expect(summaryEntry).toMatchObject({
      type: "branch_summary",
      parentId: user1,
      fromId: user1,
    });
    const context = await Effect.runPromise(session.buildContext());
    expect(context.messages[1]?.role).toBe("branchSummary");
  });

  it("supports custom message entries in context", async () => {
    const session = await createTestSession();
    await Effect.runPromise(session.appendMessage(createUserMessage("one")));
    await Effect.runPromise(
      session.appendCustomMessageEntry("custom", "hello", true, { ok: true }),
    );
    const context = await Effect.runPromise(session.buildContext());
    expect(context.messages[1]?.role).toBe("custom");
  });

  it("supports labels and session info entries without affecting context", async () => {
    const session = await createTestSession();
    const user1 = await Effect.runPromise(session.appendMessage(createUserMessage("one")));
    await Effect.runPromise(session.appendLabel(user1, "checkpoint"));
    await Effect.runPromise(session.appendSessionName("name"));
    const entries = await Effect.runPromise(session.getEntries());
    expect(entries.some((entry) => entry.type === "label")).toBe(true);
    expect(entries.some((entry) => entry.type === "session_info")).toBe(true);
    expect(await Effect.runPromise(session.getLabel(user1))).toBe("checkpoint");
    expect(await Effect.runPromise(session.getSessionName())).toBe("name");
    expect((await Effect.runPromise(session.buildContext())).messages).toHaveLength(1);
  });

  it("rejects labels for missing entries", async () => {
    const session = await createTestSession();
    await expect(Effect.runPromise(session.appendLabel("missing", "checkpoint"))).rejects.toThrow(
      "Entry missing not found",
    );
  });

  it("persists leaf changes and appended entries via shared storage", async () => {
    const session = await createTestSession();
    const user1 = await Effect.runPromise(session.appendMessage(createUserMessage("one")));
    await Effect.runPromise(session.appendMessage(createAssistantMessage("two")));
    await Effect.runPromise(session.appendLabel(user1, "checkpoint"));
    await Effect.runPromise(session.appendSessionName("name"));
    await Effect.runPromise(session.moveTo(user1));
    await Effect.runPromise(session.appendMessage(createAssistantMessage("branched")));
    const context = await Effect.runPromise(session.buildContext());
    expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(await Effect.runPromise(session.getLabel(user1))).toBe("checkpoint");
    expect(await Effect.runPromise(session.getSessionName())).toBe("name");
  });
});
