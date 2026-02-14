import { randomUUID } from "node:crypto";
import type {
  ProviderAuthMethodDescriptor,
  ProviderOAuthAuthorizeResponse,
  ProviderOAuthCallbackResponse,
} from "../types";
import type { ProviderAuthService } from "./service";

interface DeviceCodeResponse {
  verification_uri?: string;
  verification_uri_complete?: string;
  user_code?: string;
  device_code?: string;
  interval?: number;
  expires_in?: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  account_label?: string;
}

interface OAuthSuccessPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountLabel?: string;
}

interface OAuthCallbackPendingResult {
  type: "pending";
}

interface OAuthCallbackConnectedResult {
  type: "connected";
  payload: OAuthSuccessPayload;
}

type OAuthCallbackResult = OAuthCallbackPendingResult | OAuthCallbackConnectedResult;

interface OAuthPendingAuthorization {
  providerId: string;
  callback: (code?: string) => Promise<OAuthCallbackResult>;
}

interface OAuthMethodDefinition {
  type: "token" | "oauth";
  label: string;
  authorize?: (inputs?: Record<string, unknown>) => Promise<{
    method: "auto" | "code";
    url: string;
    instructions: string;
    callback: (code?: string) => Promise<OAuthCallbackResult>;
  }>;
}

interface OAuthAuthorizeInput {
  providerId: string;
  method: number;
  inputs?: Record<string, unknown>;
}

interface OAuthCallbackInput {
  providerId: string;
  method: number;
  authorizationId: string;
  code?: string;
}

const pending = new Map<string, OAuthPendingAuthorization>();

function env(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) return fallback;
  return value.trim();
}

function zaiOAuthConfig() {
  const issuer = env("EKACODE_ZAI_OAUTH_ISSUER", "https://chat.z.ai");
  return {
    issuer,
    clientId: env("EKACODE_ZAI_OAUTH_CLIENT_ID", "opencode-desktop"),
    scope: env("EKACODE_ZAI_OAUTH_SCOPE", "openid profile offline_access"),
    flow: env("EKACODE_ZAI_OAUTH_FLOW", "auto"),
    deviceEndpoint: env("EKACODE_ZAI_OAUTH_DEVICE_ENDPOINT", `${issuer}/oauth/device/code`),
    tokenEndpoint: env("EKACODE_ZAI_OAUTH_TOKEN_ENDPOINT", `${issuer}/oauth/token`),
    authorizeUrl: env("EKACODE_ZAI_OAUTH_AUTHORIZE_URL", `${issuer}/oauth/authorize`),
    redirectUri: env("EKACODE_ZAI_OAUTH_REDIRECT_URI", "urn:ietf:wg:oauth:2.0:oob"),
  };
}

async function readOAuthError(response: Response): Promise<string> {
  const fallback = `oauth_http_${response.status}`;
  try {
    const payload = (await response.json()) as { error?: string; error_description?: string };
    const code = payload.error ?? fallback;
    const detail = payload.error_description ? `: ${payload.error_description}` : "";
    return `${code}${detail}`;
  } catch {
    return fallback;
  }
}

function zaiOAuthMethods(): OAuthMethodDefinition[] {
  const config = zaiOAuthConfig();

  return [
    {
      type: "token",
      label: "API Token",
    },
    {
      type: "oauth",
      label: "Connect with Zen",
      async authorize() {
        if (config.flow === "code") {
          const params = new URLSearchParams({
            response_type: "code",
            client_id: config.clientId,
            scope: config.scope,
            redirect_uri: config.redirectUri,
          });
          return {
            method: "code",
            url: `${config.authorizeUrl}?${params.toString()}`,
            instructions: "Authorize in browser, then paste the returned code.",
            callback: async (code?: string) => {
              if (!code || code.trim().length === 0) return { type: "pending" };

              const tokenResponse = await fetch(config.tokenEndpoint, {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  grant_type: "authorization_code",
                  code: code.trim(),
                  client_id: config.clientId,
                  redirect_uri: config.redirectUri,
                }),
              });

              if (!tokenResponse.ok) {
                throw new Error(
                  `OAuth code exchange failed: ${await readOAuthError(tokenResponse)}`
                );
              }

              const token = (await tokenResponse.json()) as TokenResponse;
              if (!token.access_token) return { type: "pending" };
              return {
                type: "connected",
                payload: {
                  accessToken: token.access_token,
                  refreshToken: token.refresh_token ?? token.access_token,
                  expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
                  accountLabel: token.account_label,
                },
              };
            },
          };
        }

        const device = await fetch(config.deviceEndpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            client_id: config.clientId,
            scope: config.scope,
          }),
        });

        if (!device.ok) {
          throw new Error(`OAuth authorization init failed: ${await readOAuthError(device)}`);
        }

        const payload = (await device.json()) as DeviceCodeResponse;
        if (!payload.device_code) {
          throw new Error("OAuth authorization init failed: missing device_code");
        }

        const pollIntervalMs = Math.max(1000, (payload.interval ?? 5) * 1000);
        let nextPollAllowedAt = 0;

        return {
          method: "auto",
          url: payload.verification_uri_complete ?? payload.verification_uri ?? config.issuer,
          instructions: payload.user_code
            ? `Enter code: ${payload.user_code}`
            : "Continue authorization in your browser.",
          callback: async () => {
            const now = Date.now();
            if (now < nextPollAllowedAt) {
              return { type: "pending" };
            }
            nextPollAllowedAt = now + pollIntervalMs;

            const tokenResponse = await fetch(config.tokenEndpoint, {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                client_id: config.clientId,
                device_code: payload.device_code,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
              }),
            });

            if (!tokenResponse.ok) {
              throw new Error(`OAuth token polling failed: ${await readOAuthError(tokenResponse)}`);
            }

            const token = (await tokenResponse.json()) as TokenResponse;
            if (token.access_token) {
              return {
                type: "connected",
                payload: {
                  accessToken: token.access_token,
                  refreshToken: token.refresh_token ?? token.access_token,
                  expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
                  accountLabel: token.account_label,
                },
              };
            }

            if (token.error === "authorization_pending" || token.error === "slow_down") {
              return { type: "pending" };
            }

            throw new Error(`OAuth callback failed: ${token.error ?? "unknown_oauth_error"}`);
          },
        };
      },
    },
  ];
}

function methodsByProvider(providerId: string): OAuthMethodDefinition[] {
  switch (providerId) {
    case "zai":
      return zaiOAuthMethods();
    default:
      return [{ type: "token", label: "API Token" }];
  }
}

export function listProviderAuthMethods(
  providerIds: string[]
): Record<string, ProviderAuthMethodDescriptor[]> {
  return Object.fromEntries(
    providerIds.map(providerId => [
      providerId,
      methodsByProvider(providerId).map(method => ({ type: method.type, label: method.label })),
    ])
  );
}

export async function startOAuth(
  input: OAuthAuthorizeInput
): Promise<ProviderOAuthAuthorizeResponse> {
  const methods = methodsByProvider(input.providerId);
  const selected = methods[input.method];
  if (!selected || selected.type !== "oauth" || !selected.authorize) {
    throw new Error(`Invalid oauth method for provider ${input.providerId}`);
  }

  const authorization = await selected.authorize(input.inputs);
  const authorizationId = randomUUID();

  pending.set(authorizationId, {
    providerId: input.providerId,
    callback: authorization.callback,
  });

  return {
    providerId: input.providerId,
    authorizationId,
    url: authorization.url,
    method: authorization.method,
    instructions: authorization.instructions,
  };
}

export async function completeOAuth(
  input: OAuthCallbackInput,
  authService: ProviderAuthService
): Promise<ProviderOAuthCallbackResponse> {
  const match = pending.get(input.authorizationId);
  if (!match || match.providerId !== input.providerId) {
    throw new Error(`OAuth authorization not found for ${input.providerId}`);
  }

  const callback = await match.callback(input.code);
  if (callback.type === "pending") {
    return { status: "pending" };
  }

  await authService.setOAuth({
    providerId: input.providerId,
    accessToken: callback.payload.accessToken,
    refreshToken: callback.payload.refreshToken,
    expiresAt: callback.payload.expiresAt,
    accountLabel: callback.payload.accountLabel,
  });
  pending.delete(input.authorizationId);
  return { status: "connected" };
}

export async function resolveOAuthAccessToken(
  providerId: string,
  authService: Pick<ProviderAuthService, "getCredential" | "setOAuth">
): Promise<string | null> {
  const credential = await authService.getCredential(providerId);
  if (!credential || credential.kind !== "oauth") return null;

  const now = Date.now();
  if (credential.oauth.expiresAt > now + 15_000) {
    return credential.oauth.accessToken;
  }

  if (providerId !== "zai") {
    return credential.oauth.accessToken;
  }

  const config = zaiOAuthConfig();
  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: credential.oauth.refreshToken,
      client_id: config.clientId,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth refresh failed: ${await readOAuthError(response)}`);
  }

  const token = (await response.json()) as TokenResponse;
  if (!token.access_token) {
    throw new Error("OAuth refresh failed: missing_access_token");
  }

  await authService.setOAuth({
    providerId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? credential.oauth.refreshToken,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    accountLabel: token.account_label ?? credential.oauth.accountLabel,
  });

  return token.access_token;
}
