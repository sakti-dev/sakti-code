import type { ProviderOAuthAuthorizeResponse, ProviderOAuthCallbackResponse } from "../types";
import {
  getProviderAuthDefinition,
  getProviderAuthMethods,
  listProviderAuthMethods as listProviderAuthMethodsFromRegistry,
} from "./registry";
import type { ProviderAuthService } from "./service";
import {
  clearOAuthPendingAuthorization,
  createOAuthPendingAuthorization,
  findOAuthPendingAuthorization,
} from "./session";

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

export function listProviderAuthMethods(providerIds: string[]) {
  return listProviderAuthMethodsFromRegistry(providerIds);
}

export async function startOAuth(
  input: OAuthAuthorizeInput
): Promise<ProviderOAuthAuthorizeResponse> {
  const methods = getProviderAuthMethods(input.providerId);
  const selected = methods[input.method];
  if (!selected || selected.type !== "oauth" || !selected.authorize) {
    throw new Error(`Invalid oauth method for provider ${input.providerId}`);
  }

  const authorization = await selected.authorize(input.inputs);
  const authorizationId = createOAuthPendingAuthorization({
    providerId: input.providerId,
    method: input.method,
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
  const match = findOAuthPendingAuthorization({
    authorizationId: input.authorizationId,
    providerId: input.providerId,
    method: input.method,
  });
  if (!match) {
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
  clearOAuthPendingAuthorization(input.authorizationId);
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

  const definition = getProviderAuthDefinition(providerId);
  if (!definition?.refreshOAuthToken) {
    return credential.oauth.accessToken;
  }

  const refreshed = await definition.refreshOAuthToken({
    refreshToken: credential.oauth.refreshToken,
    accountLabel: credential.oauth.accountLabel,
  });

  await authService.setOAuth({
    providerId,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? credential.oauth.refreshToken,
    expiresAt: refreshed.expiresAt,
    accountLabel: refreshed.accountLabel ?? credential.oauth.accountLabel,
  });

  return refreshed.accessToken;
}
