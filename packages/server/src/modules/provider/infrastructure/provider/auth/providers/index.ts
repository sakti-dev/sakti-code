import type { ProviderAuthDefinition } from "../definition";
import { createAnthropicProviderAuthDefinition } from "./anthropic";
import { createGitHubCopilotProviderAuthDefinition } from "./copilot";
import { createOpenAIProviderAuthDefinition } from "./openai";

export function createBuiltinProviderAuthDefinitions(): ProviderAuthDefinition[] {
  return [
    createGitHubCopilotProviderAuthDefinition(),
    createOpenAIProviderAuthDefinition(),
    createAnthropicProviderAuthDefinition(),
  ];
}
