import type { ModelDescriptor } from "./types";

export interface CapabilityInput {
  providerId: string;
  modelId: string;
  modelName?: string;
}

export function inferModelCapabilities(input: CapabilityInput): ModelDescriptor["capabilities"] {
  const id = input.modelId.toLowerCase();
  const name = (input.modelName || "").toLowerCase();
  const corpus = `${id} ${name}`;

  const vision = /\b(vision|image|multimodal)\b/.test(corpus) || /[\d]v\b/.test(id);
  const plan = /\b(plan|planner|coding-plan)\b/.test(corpus);

  return {
    text: true,
    vision,
    tools: true,
    reasoning: true,
    plan,
  };
}
