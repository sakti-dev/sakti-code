import type { Part } from "@/chat/message-v2";
import { createProcessorContext, processStream } from "@/chat/processor";
import { describe, expect, it } from "vitest";

function asStream(events: Array<Record<string, unknown>>): AsyncIterable<Record<string, unknown>> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

describe("chat/processor", () => {
  it("maps step-finish usage into emitted part tokens and cost", async () => {
    const context = createProcessorContext("session-1", "message-1");
    const createdParts: Part[] = [];

    await processStream(
      asStream([
        { type: "start" },
        { type: "step-start", stepId: "step-1" },
        {
          type: "step-finish",
          stepId: "step-1",
          reason: "stop",
          usage: {
            inputTokens: 12,
            outputTokens: 34,
            reasoningTokens: 5,
            cacheReadInputTokens: 6,
            cacheWriteInputTokens: 2,
            cost: 0.42,
          },
        },
        { type: "finish", finishReason: "stop" },
      ]) as unknown as AsyncIterable<
        Parameters<typeof processStream>[0] extends AsyncIterable<infer T> ? T : never
      >,
      context,
      {
        onPartCreated(part) {
          createdParts.push(part);
        },
      }
    );

    const stepFinish = createdParts.find(part => part.type === "step-finish") as Extract<
      Part,
      { type: "step-finish" }
    >;
    expect(stepFinish).toBeDefined();
    expect(stepFinish.cost).toBe(0.42);
    expect(stepFinish.tokens).toEqual({
      input: 12,
      output: 34,
      reasoning: 5,
      cache: { read: 6, write: 2 },
    });
  });

  it("handles null tool-result payloads without throwing", async () => {
    const context = createProcessorContext("session-2", "message-2");
    const updatedParts: Part[] = [];

    await expect(
      processStream(
        asStream([
          { type: "start" },
          { type: "tool-call", toolCallId: "call-1", toolName: "noop", args: {} },
          {
            type: "tool-result",
            toolCallId: "call-1",
            result: null as unknown as string | { error?: string; result?: string },
          },
          { type: "finish", finishReason: "stop" },
        ]) as unknown as AsyncIterable<
          Parameters<typeof processStream>[0] extends AsyncIterable<infer T> ? T : never
        >,
        context,
        {
          onPartUpdated(part) {
            updatedParts.push(part);
          },
        }
      )
    ).resolves.toBeUndefined();

    const toolPart = updatedParts.find(part => part.type === "tool") as Extract<
      Part,
      { type: "tool" }
    >;
    expect(toolPart).toBeDefined();
    expect(toolPart.state.status).toBe("completed");
  });
});
