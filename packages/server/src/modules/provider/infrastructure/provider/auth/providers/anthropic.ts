import type { ProviderAuthDefinition } from "../definition";

export function createAnthropicProviderAuthDefinition(): ProviderAuthDefinition {
  return {
    providerId: "anthropic",
    methods: [
      {
        type: "api",
        label: "API Key",
      },
    ],
  };
}
