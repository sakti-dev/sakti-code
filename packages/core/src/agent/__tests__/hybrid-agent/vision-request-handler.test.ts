import type { PromptRegistry, VisionRequest } from "@/agent/hybrid-agent/types";
import { VisionRequestHandler } from "@/agent/hybrid-agent/vision-request-handler";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

function createPromptRegistry(): PromptRegistry {
  return {
    register() {},
    get() {
      return undefined;
    },
    list() {
      return [];
    },
    resolve({ userText }) {
      return {
        system: "Analyze image",
        user: userText,
      };
    },
  };
}

describe("VisionRequestHandler", () => {
  it("executePerImage waits for all requests and preserves request index ordering", async () => {
    const delayMap = new Map([
      ["first", 30],
      ["second", 5],
      ["third", 10],
    ]);

    const visionModel = {
      async doGenerate(options: { prompt: Array<{ role: string; content: unknown }> }) {
        const user = options.prompt[1] as {
          content: Array<{ type: string; text?: string }>;
        };
        const textPart = user.content.find(part => part.type === "text");
        const key = textPart?.text ?? "";
        const delayMs = delayMap.get(key) ?? 0;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return {
          content: [{ type: "text", text: `analysis:${key}` }],
        };
      },
    } as unknown as LanguageModelV3;

    const handler = new VisionRequestHandler(visionModel, createPromptRegistry());
    const requests: VisionRequest[] = ["first", "second", "third"].map(name => ({
      intent: { id: "general-image", confidence: 0.8 },
      images: [{ id: `${name}-img`, data: "abc", mediaType: "image/png" }],
      userText: name,
    }));

    const results = await handler.executePerImage(requests, 2);

    expect(results).toEqual([
      "Image 1:\nanalysis:first",
      "Image 2:\nanalysis:second",
      "Image 3:\nanalysis:third",
    ]);
  });
});
