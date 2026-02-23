import { QuestionManager, QuestionRejectedError } from "@sakti-code/core/server";
import { beforeEach, describe, expect, it } from "vitest";

describe("questions routes", () => {
  const manager = QuestionManager.getInstance();

  beforeEach(() => {
    manager.reset();
  });

  it("lists pending question requests", async () => {
    const askPromise = manager.ask({
      sessionID: "session-1",
      questions: [{ question: "Which mode?" }],
    });

    const router = (await import("../questions")).default;
    const response = await router.request("http://localhost/pending");
    const body = (await response.json()) as { pending: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(body.pending).toHaveLength(1);

    manager.reply({ id: body.pending[0]!.id, reply: "build" });
    await expect(askPromise).resolves.toBe("build");
  });

  it("replies to a pending question", async () => {
    const askPromise = manager.ask({
      sessionID: "session-2",
      questions: [{ question: "Continue?" }],
    });

    const [pending] = manager.getPendingRequests();
    expect(pending).toBeDefined();

    const router = (await import("../questions")).default;
    const response = await router.request("http://localhost/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: pending!.id,
        reply: "yes",
      }),
    });

    expect(response.status).toBe(200);
    await expect(askPromise).resolves.toBe("yes");
  });

  it("rejects a pending question", async () => {
    const askPromise = manager.ask({
      sessionID: "session-3",
      questions: [{ question: "Skip this step?" }],
    });

    const [pending] = manager.getPendingRequests();
    expect(pending).toBeDefined();

    const router = (await import("../questions")).default;
    const response = await router.request("http://localhost/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: pending!.id,
        reason: "not needed",
      }),
    });

    expect(response.status).toBe(200);
    await expect(askPromise).rejects.toBeInstanceOf(QuestionRejectedError);
  });
});
