import type { ModelDescriptor, ProviderAuthState, ProviderDescriptor } from "../types";
import type { ProviderAdapter, SetProviderCredentialInput } from "./base";

const ANTHROPIC_MODELS: ModelDescriptor[] = [
  {
    id: "anthropic/claude-3-7-sonnet-latest",
    name: "Claude 3.7 Sonnet",
    providerId: "anthropic",
    providerName: "Anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: {
      text: true,
      vision: true,
      tools: true,
      reasoning: true,
      plan: false,
    },
  },
  {
    id: "anthropic/claude-3-5-haiku-latest",
    name: "Claude 3.5 Haiku",
    providerId: "anthropic",
    providerName: "Anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: {
      text: true,
      vision: true,
      tools: true,
      reasoning: true,
      plan: false,
    },
  },
];

export class AnthropicProviderAdapter implements ProviderAdapter {
  readonly id = "anthropic";

  private inMemoryToken: string | null = null;

  describe(): ProviderDescriptor {
    return {
      id: "anthropic",
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      api: true,
      models: true,
      auth: { kind: "token" },
    };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return ANTHROPIC_MODELS;
  }

  async getAuthState(): Promise<ProviderAuthState> {
    const hasToken = Boolean(this.inMemoryToken || process.env.ANTHROPIC_API_KEY);

    return {
      providerId: "anthropic",
      status: hasToken ? "connected" : "disconnected",
      method: "token",
      accountLabel: null,
      updatedAt: new Date().toISOString(),
    };
  }

  async setCredential(input: SetProviderCredentialInput): Promise<void> {
    this.inMemoryToken = input.token;
  }

  async clearCredential(): Promise<void> {
    this.inMemoryToken = null;
  }
}
