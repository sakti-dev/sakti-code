import type { ModelDescriptor, ProviderAuthState, ProviderDescriptor } from "../types";
import type { ProviderAdapter, SetProviderCredentialInput } from "./base";

const OPENAI_MODELS: ModelDescriptor[] = [
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    providerId: "openai",
    providerName: "OpenAI",
    contextWindow: 128000,
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
    id: "openai/gpt-4o-mini",
    name: "GPT-4o mini",
    providerId: "openai",
    providerName: "OpenAI",
    contextWindow: 128000,
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

export class OpenAIProviderAdapter implements ProviderAdapter {
  readonly id = "openai";

  private inMemoryToken: string | null = null;

  describe(): ProviderDescriptor {
    return {
      id: "openai",
      name: "OpenAI",
      env: ["OPENAI_API_KEY"],
      api: true,
      models: true,
      auth: { kind: "token" },
    };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return OPENAI_MODELS;
  }

  async getAuthState(): Promise<ProviderAuthState> {
    const hasToken = Boolean(this.inMemoryToken || process.env.OPENAI_API_KEY);

    return {
      providerId: "openai",
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
