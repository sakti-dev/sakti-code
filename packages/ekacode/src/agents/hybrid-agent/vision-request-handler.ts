/**
 * Vision Request Handler
 *
 * Handles vision model API calls for image analysis.
 */

import type { LanguageModelV3, LanguageModelV3Content } from "@ai-sdk/provider";
import type { PromptRegistry, VisionImage, VisionRequest } from "./types";
import { buildVisionPrompt } from "./vision-prompt-builder";

/**
 * Extract text content from model response
 */
export function extractTextFromContent(content: LanguageModelV3Content[]): string {
  let text = "";
  for (const part of content) {
    if (part.type === "text") {
      text += part.text;
    }
  }
  return text;
}

/**
 * Convert images to prompt content parts
 */
export function imagesToContentParts(images: VisionImage[]): LanguageModelV3Content[] {
  const parts: LanguageModelV3Content[] = [];

  for (const image of images) {
    parts.push({
      type: "file",
      data: typeof image.data === "string" ? image.data : image.data,
      mediaType: image.mediaType,
    });
  }

  return parts;
}

/**
 * Vision request handler
 *
 * Executes vision analysis using the vision model.
 */
export class VisionRequestHandler {
  constructor(
    private visionModel: LanguageModelV3,
    private promptRegistry: PromptRegistry
  ) {}

  /**
   * Execute a vision request and return the analysis text
   */
  async execute(request: VisionRequest): Promise<string> {
    const options = this.buildOptions(request);
    const result = await this.visionModel.doGenerate(options);
    return extractTextFromContent(result.content);
  }

  /**
   * Execute a vision request with streaming
   */
  async *executeStream(request: VisionRequest): AsyncGenerator<string, void, unknown> {
    const options = this.buildOptions(request);
    const { stream } = await this.visionModel.doStream(options);

    for await (const part of stream) {
      if (part.type === "text-delta") {
        yield part.delta;
      }
    }
  }

  /**
   * Build call options from vision request
   */
  private buildOptions(request: VisionRequest): Parameters<LanguageModelV3["doGenerate"]>[0] {
    const prompt = buildVisionPrompt(request, this.promptRegistry);
    return { prompt };
  }

  /**
   * Execute multiple vision requests for per-image strategy
   */
  async executePerImage(requests: VisionRequest[], concurrency: number = 3): Promise<string[]> {
    const results: Array<string | undefined> = new Array(requests.length);
    const executing: Promise<void>[] = [];

    for (const [index, request] of requests.entries()) {
      const promise = this.execute(request).then(result => {
        results[index] = result;
      });

      executing.push(promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
        executing.splice(
          executing.findIndex(p => p === promise),
          1
        );
      }
    }

    await Promise.all(executing);

    // Label results by image index
    return results.map((result, index) => `Image ${index + 1}:\n${result ?? ""}`);
  }
}
