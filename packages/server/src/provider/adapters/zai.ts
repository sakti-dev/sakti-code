import type { ModelDescriptor, ProviderAuthState, ProviderDescriptor } from "../types";
import type { ProviderAdapter, SetProviderCredentialInput } from "./base";

const ZAI_MODELS: ModelDescriptor[] = [
  {
    id: "zai/glm-4.7",
    name: "GLM-4.7",
    providerId: "zai",
    providerName: "Z.AI",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: {
      text: true,
      vision: false,
      tools: true,
      reasoning: true,
      plan: true,
    },
  },
  {
    id: "zai/glm-4.6v",
    name: "GLM-4.6V",
    providerId: "zai",
    providerName: "Z.AI",
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

export class ZaiProviderAdapter implements ProviderAdapter {
  readonly id = "zai";

  private inMemoryToken: string | null = null;

  describe(): ProviderDescriptor {
    return {
      id: "zai",
      name: "Z.AI",
      env: ["ZAI_API_KEY"],
      api: true,
      models: true,
      auth: { kind: "token" },
    };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return ZAI_MODELS;
  }

  async getAuthState(): Promise<ProviderAuthState> {
    const hasToken = Boolean(this.inMemoryToken || process.env.ZAI_API_KEY);

    return {
      providerId: "zai",
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
