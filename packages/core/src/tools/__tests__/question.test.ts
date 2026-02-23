import { Instance } from "@/instance";
import { QuestionManager } from "@/session/question-manager";
import { questionTool } from "@/tools/question";
import { beforeEach, describe, expect, it } from "vitest";

type QuestionExecuteOptions = Parameters<NonNullable<typeof questionTool.execute>>[1];

describe("question tool", () => {
  const manager = QuestionManager.getInstance();
  const toolOptions: QuestionExecuteOptions = {
    toolCallId: "question-tool-call",
    messages: [],
  };

  beforeEach(() => {
    manager.reset();
  });

  it("asks a question and returns the user reply in metadata", async () => {
    await Instance.provide({
      directory: "/tmp",
      sessionID: "session-1",
      messageID: "message-1",
      async fn() {
        const execute = questionTool.execute;
        if (!execute) {
          throw new Error("questionTool.execute is undefined");
        }

        const run = execute(
          {
            questions: [
              {
                header: "Mode",
                question: "Which flow should we run?",
                options: [
                  { label: "Comprehensive", description: "Full lifecycle" },
                  { label: "Quick", description: "Fast path" },
                ],
              },
            ],
          },
          toolOptions
        );

        const [pending] = manager.getPendingRequests();
        expect(pending).toBeDefined();
        expect(pending?.tool?.callID).toBe("question-tool-call");
        expect(pending?.tool?.messageID).toBe("message-1");

        manager.reply({ id: pending!.id, reply: "Comprehensive" });

        const result = (await run) as {
          title: string;
          output: string;
          metadata: { reply: unknown };
        };

        expect(result.title).toContain("Asked");
        expect(result.metadata.reply).toBe("Comprehensive");
      },
    });
  });
});
