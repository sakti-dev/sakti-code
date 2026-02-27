export interface OAuthSuccessPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountLabel?: string;
}

export interface OAuthCallbackPendingResult {
  type: "pending";
}

export interface OAuthCallbackConnectedResult {
  type: "connected";
  payload: OAuthSuccessPayload;
}

export type OAuthCallbackResult = OAuthCallbackPendingResult | OAuthCallbackConnectedResult;

export interface OAuthAuthorization {
  method: "auto" | "code";
  url: string;
  instructions: string;
  callback: (code?: string) => Promise<OAuthCallbackResult>;
}

export interface ProviderAuthPromptText {
  type: "text";
  key: string;
  message: string;
  placeholder?: string;
}

export interface ProviderAuthPromptSelect {
  type: "select";
  key: string;
  message: string;
  options: Array<{
    label: string;
    value: string;
    hint?: string;
  }>;
}

export type ProviderAuthPrompt = ProviderAuthPromptText | ProviderAuthPromptSelect;

export interface ProviderOAuthRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  accountLabel?: string;
}

export interface ProviderAuthMethodDefinition {
  type: "api" | "oauth" | "token";
  label: string;
  prompts?: ProviderAuthPrompt[];
  authorize?: (inputs?: Record<string, unknown>) => Promise<OAuthAuthorization>;
}

export interface ProviderAuthDefinition {
  providerId: string;
  methods: ProviderAuthMethodDefinition[];
  refreshOAuthToken?: (input: {
    refreshToken: string;
    accountLabel?: string;
  }) => Promise<ProviderOAuthRefreshResult>;
}
