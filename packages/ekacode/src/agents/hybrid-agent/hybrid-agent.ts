/**
 * Hybrid Agent
 *
 * Provider-agnostic hybrid agent that combines text and vision models.
 * Implements LanguageModelV3 for seamless integration with AI SDK.
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { extractImagesAndText, selectVisionStrategy, stripImageParts } from "./image-utils";
import { IntentClassifier } from "./intent-classifier";
import { injectVisionAnalysis } from "./prompt-injector";
import type { HybridAgentOptions, Intent, VisionImage } from "./types";
import { buildMultiImageVisionPrompt } from "./vision-prompt-builder";
import { extractTextFromContent, VisionRequestHandler } from "./vision-request-handler";

/**
 * Hybrid Agent class
 *
 * Combines text and vision models to provide intelligent image analysis
 * with full conversation context.
 */
export class HybridAgent implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly modelId: string;

  // Supported URL patterns for images
  readonly supportedUrls = {
    "image/*": [/^https?:\/\/.*$/, /^data:image\/.*$/],
  };

  private textModel: LanguageModelV3;
  private visionModel: LanguageModelV3;
  private promptRegistry: ReturnType<HybridAgentOptions["loadPrompts"]>;
  private intentClassifier: IntentClassifier;
  private visionRequestHandler: VisionRequestHandler;
  private normalizeImage:
    | ((image: { id: string; data: string | Uint8Array; mediaType: string }) => {
        id: string;
        data: string | Uint8Array;
        mediaType: string;
      })
    | undefined;

  constructor(options: HybridAgentOptions) {
    this.modelId = options.modelId ?? "hybrid";
    this.textModel = options.textModel;
    this.visionModel = options.visionModel;
    this.promptRegistry = options.loadPrompts();
    this.intentClassifier = new IntentClassifier(this.textModel, this.promptRegistry);
    this.visionRequestHandler = new VisionRequestHandler(this.visionModel, this.promptRegistry);
    this.normalizeImage = options.normalizeImage;
  }

  get provider(): string {
    return "hybrid";
  }

  /**
   * Non-streaming generation
   */
  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { images, userText, hasImages } = extractImagesAndText(
      options.prompt,
      this.normalizeImage
    );

    // If no images, delegate to text model
    if (!hasImages) {
      return this.textModel.doGenerate(options);
    }

    // Classify intent
    const intent = await this.intentClassifier.classify(options.prompt);

    // Run vision analysis (non-streaming)
    const visionText = await this.runVisionNonStreaming({
      intent,
      images,
      userText,
    });

    // Inject vision analysis into prompt
    const injectedPrompt = injectVisionAnalysis({
      prompt: stripImageParts(options.prompt),
      analysis: visionText,
    });

    // Generate response with text model
    return this.textModel.doGenerate({
      ...options,
      prompt: injectedPrompt,
    });
  }

  /**
   * Streaming generation
   */
  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const { images, userText, hasImages } = extractImagesAndText(
      options.prompt,
      this.normalizeImage
    );

    // If no images, delegate to text model
    if (!hasImages) {
      return this.textModel.doStream(options);
    }

    // Classify intent
    const intent = await this.intentClassifier.classify(options.prompt);

    // Stream with vision analysis
    return this.streamHybrid({
      options,
      intent,
      images,
      userText,
    });
  }

  /**
   * Run non-streaming vision analysis
   */
  private async runVisionNonStreaming(request: {
    intent: Intent;
    images: VisionImage[];
    userText: string;
  }): Promise<string> {
    const { intent, images, userText } = request;

    // Select strategy
    const strategy = selectVisionStrategy(intent, userText);

    if (strategy === "multi" && images.length > 1) {
      // Multi-image: single call with all images
      const prompt = buildMultiImageVisionPrompt(images, userText, this.promptRegistry);
      const result = await this.visionModel.doGenerate({ prompt });
      return extractTextFromContent(result.content);
    } else {
      // Per-image: separate calls
      const results: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const result = await this.visionRequestHandler.execute({
          intent,
          images: [images[i]],
          userText,
        });
        results.push(`Image ${i + 1}:\n${result}`);
      }
      return results.join("\n\n---\n\n");
    }
  }

  /**
   * Stream with vision analysis
   */
  private async streamHybrid(request: {
    options: LanguageModelV3CallOptions;
    intent: Intent;
    images: { id: string; data: string | Uint8Array; mediaType: string }[];
    userText: string;
  }): Promise<LanguageModelV3StreamResult> {
    const { options, images, userText } = request;

    // Capture instance variables for use in stream callback
    const visionModel = this.visionModel;
    const textModel = this.textModel;
    const promptRegistry = this.promptRegistry;

    // Create a transform stream for the hybrid response
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        try {
          const visionBuffer: string[] = [];
          let isFirstVisionChunk = true;

          // 1) Stream vision analysis
          const visionStreamResult = await visionModel.doStream({
            prompt: buildMultiImageVisionPrompt(images, userText, promptRegistry),
          });

          // Emit vision analysis with prefix
          controller.enqueue({
            type: "text-delta",
            id: "0",
            delta: "\n\n[🔍 Vision Analysis]\n\n",
          });

          for await (const part of visionStreamResult.stream) {
            if (part.type === "text-delta") {
              const prefix = isFirstVisionChunk ? "" : "";
              isFirstVisionChunk = false;
              visionBuffer.push(part.delta);
              controller.enqueue({
                type: "text-delta",
                id: "0",
                delta: prefix + part.delta,
              });
            }
          }

          controller.enqueue({
            type: "text-delta",
            id: "0",
            delta: "\n\n[✓ Vision Complete]\n\n",
          });

          // 2) Inject full vision analysis and stream text model response
          const analysis = visionBuffer.join("");
          const injectedPrompt = injectVisionAnalysis({
            prompt: stripImageParts(options.prompt),
            analysis,
          });

          const textStreamResult = await textModel.doStream({
            ...options,
            prompt: injectedPrompt,
          });

          // 3) Stream final response from text model
          for await (const part of textStreamResult.stream) {
            controller.enqueue(part);
          }

          controller.close();
        } catch (_error) {
          controller.enqueue({
            type: "text-delta",
            id: "0",
            delta: "\n\n[Error: Vision analysis failed]",
          });
          controller.close();
        }
      },
    });

    return {
      stream,
      request: { body: undefined },
      response: { headers: {} },
    };
  }
}
