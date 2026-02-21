export interface ProviderDescriptor {
  id: string;
  name: string;
  env?: string[];
  api?: boolean;
  models?: boolean;
  auth?: {
    kind: "token" | "oauth" | "none";
  };
}

export interface ProviderAuthState {
  providerId: string;
  status: "connected" | "disconnected" | "error" | "oauth_required";
  method: "token" | "oauth" | "none";
  accountLabel: string | null;
  updatedAt: string;
}

export interface ProviderAuthMethodDescriptor {
  type: "api" | "token" | "oauth" | "none";
  label: string;
  prompts?: Array<
    | {
        type: "text";
        key: string;
        message: string;
        placeholder?: string;
      }
    | {
        type: "select";
        key: string;
        message: string;
        options: Array<{ label: string; value: string; hint?: string }>;
      }
  >;
}

export interface ProviderOAuthAuthorizeResponse {
  providerId: string;
  authorizationId: string;
  url: string;
  method: "auto" | "code";
  instructions: string;
}

export interface ProviderOAuthCallbackResponse {
  status: "pending" | "connected";
}

export interface ProviderPreferences {
  selectedProviderId: string | null;
  selectedModelId: string | null;
  hybridEnabled: boolean;
  hybridVisionProviderId: string | null;
  hybridVisionModelId: string | null;
  updatedAt: string;
}

export interface ProviderModel {
  id: string;
  providerId: string;
  providerName?: string;
  name?: string;
  modalities?: {
    input: Array<"text" | "audio" | "image" | "video" | "pdf">;
    output: Array<"text" | "audio" | "image" | "video" | "pdf">;
  };
  capabilities?: {
    text: boolean;
    vision: boolean;
    tools: boolean;
    reasoning: boolean;
    plan: boolean;
  };
}

export interface ProviderCatalogItem {
  id: string;
  name: string;
  aliases: string[];
  authMethods: ProviderAuthMethodDescriptor[];
  connected: boolean;
  modelCount: number;
  popular: boolean;
  supported?: boolean;
  note?: string;
}

export interface ProviderClient {
  listProviders(): Promise<ProviderDescriptor[]>;
  listProviderCatalog?(): Promise<ProviderCatalogItem[]>;
  listAuthMethods(): Promise<Record<string, ProviderAuthMethodDescriptor[]>>;
  listAuthStates(): Promise<Record<string, ProviderAuthState>>;
  listModels(): Promise<ProviderModel[]>;
  setToken(providerId: string, token: string): Promise<void>;
  clearToken(providerId: string): Promise<void>;
  oauthAuthorize(
    providerId: string,
    method: number,
    inputs?: Record<string, unknown>
  ): Promise<ProviderOAuthAuthorizeResponse>;
  oauthCallback(
    providerId: string,
    method: number,
    authorizationId: string,
    code?: string
  ): Promise<ProviderOAuthCallbackResponse>;
  getPreferences(): Promise<ProviderPreferences>;
  updatePreferences(
    input: Partial<
      Pick<
        ProviderPreferences,
        | "selectedProviderId"
        | "selectedModelId"
        | "hybridEnabled"
        | "hybridVisionProviderId"
        | "hybridVisionModelId"
      >
    >
  ): Promise<ProviderPreferences>;
}

export interface CreateProviderClientOptions {
  fetcher: (path: string, init?: RequestInit) => Promise<Response>;
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function createProviderClient(options: CreateProviderClientOptions): ProviderClient {
  return {
    async listProviders() {
      const response = await options.fetcher("/api/providers", { method: "GET" });
      const data = await parseJsonOrThrow<{ providers: ProviderDescriptor[] }>(response);
      return data.providers ?? [];
    },

    async listProviderCatalog() {
      const response = await options.fetcher("/api/providers/catalog", { method: "GET" });
      const data = await parseJsonOrThrow<{ providers: ProviderCatalogItem[] }>(response);
      return data.providers ?? [];
    },

    async listAuthStates() {
      try {
        const response = await options.fetcher("/api/providers/auth", { method: "GET" });
        if (!response.ok) {
          console.warn("[provider-client] listAuthStates failed, returning empty states");
          return {};
        }
        return parseJsonOrThrow<Record<string, ProviderAuthState>>(response);
      } catch (error) {
        console.warn("[provider-client] listAuthStates error, returning empty states:", error);
        return {};
      }
    },

    async listAuthMethods() {
      const response = await options.fetcher("/api/providers/auth/methods", { method: "GET" });
      return parseJsonOrThrow<Record<string, ProviderAuthMethodDescriptor[]>>(response);
    },

    async listModels() {
      const response = await options.fetcher("/api/providers/models", { method: "GET" });
      const data = await parseJsonOrThrow<{ models: ProviderModel[] }>(response);
      return data.models ?? [];
    },

    async setToken(providerId, token) {
      const response = await options.fetcher(`/api/providers/${providerId}/auth/token`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ token }),
      });

      await parseJsonOrThrow(response);
    },

    async clearToken(providerId) {
      const response = await options.fetcher(`/api/providers/${providerId}/auth/token`, {
        method: "DELETE",
      });

      await parseJsonOrThrow(response);
    },

    async oauthAuthorize(providerId, method, inputs) {
      const response = await options.fetcher(`/api/providers/${providerId}/oauth/authorize`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          method,
          inputs,
        }),
      });

      return parseJsonOrThrow<ProviderOAuthAuthorizeResponse>(response);
    },

    async oauthCallback(providerId, method, authorizationId, code) {
      const response = await options.fetcher(`/api/providers/${providerId}/oauth/callback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          method,
          authorizationId,
          code,
        }),
      });

      return parseJsonOrThrow<ProviderOAuthCallbackResponse>(response);
    },

    async getPreferences() {
      const response = await options.fetcher("/api/providers/preferences", { method: "GET" });
      return parseJsonOrThrow<ProviderPreferences>(response);
    },

    async updatePreferences(input) {
      const response = await options.fetcher("/api/providers/preferences", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
      return parseJsonOrThrow<ProviderPreferences>(response);
    },
  };
}
