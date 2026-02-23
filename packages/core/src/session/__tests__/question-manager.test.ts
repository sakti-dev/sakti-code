import {
  QuestionManager,
  QuestionRejectedError,
  type QuestionPrompt,
} from "@/session/question-manager";
import { beforeEach, describe, expect, it } from "vitest";

describe("question manager", () => {
  const manager = QuestionManager.getInstance();

  const prompts: QuestionPrompt[] = [
    {
      header: "Scope",
      question: "Which scope should we target first?",
      options: [{ label: "Spec only" }, { label: "Spec + implementation" }],
    },
  ];

  beforeEach(() => {
    manager.reset();
  });

  it("creates pending requests and resolves replies", async () => {
    const askPromise = manager.ask({
      sessionID: "session-1",
      questions: prompts,
    });

    const pending = manager.getPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sessionID).toBe("session-1");
    expect(pending[0]?.questions).toEqual(prompts);

    manager.reply({ id: pending[0]!.id, reply: "Spec only" });

    await expect(askPromise).resolves.toBe("Spec only");
    expect(manager.getPendingRequests()).toHaveLength(0);
  });

  it("rejects pending requests with QuestionRejectedError", async () => {
    const askPromise = manager.ask({
      sessionID: "session-2",
      questions: prompts,
    });

    const [pending] = manager.getPendingRequests();
    expect(pending).toBeDefined();

    manager.reject({ id: pending!.id, reason: "User skipped" });

    await expect(askPromise).rejects.toBeInstanceOf(QuestionRejectedError);
    expect(manager.getPendingRequests()).toHaveLength(0);
  });

  it("ignores replies for unknown request ids", () => {
    expect(() => manager.reply({ id: "missing-id", reply: "ignored" })).not.toThrow();
    expect(() => manager.reject({ id: "missing-id" })).not.toThrow();
  });
});
