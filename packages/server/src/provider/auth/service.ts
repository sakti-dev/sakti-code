import type { ProviderCredentialStorage } from "../storage";
import type { ProviderAuthState } from "../types";

export interface SetProviderTokenInput {
  providerId: string;
  token: string;
}

export interface ProviderAuthServiceOptions {
  storage: ProviderCredentialStorage;
  profileId: string;
}

export interface OAuthCredentialValue {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountLabel?: string;
}

export interface SetProviderOAuthInput {
  providerId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountLabel?: string;
}

export type ProviderCredentialValue =
  | { kind: "token"; token: string }
  | { kind: "oauth"; oauth: OAuthCredentialValue };

export interface ProviderAuthService {
  setToken(input: SetProviderTokenInput): Promise<void>;
  setOAuth(input: SetProviderOAuthInput): Promise<void>;
  clear(providerId: string): Promise<void>;
  getState(providerId: string): Promise<ProviderAuthState>;
  getCredential(providerId: string): Promise<ProviderCredentialValue | null>;
}

export function createProviderAuthService(
  options: ProviderAuthServiceOptions
): ProviderAuthService {
  const parseOAuthSecret = (secret: string): OAuthCredentialValue | null => {
    try {
      const parsed = JSON.parse(secret) as Partial<OAuthCredentialValue>;
      if (
        typeof parsed.accessToken !== "string" ||
        typeof parsed.refreshToken !== "string" ||
        typeof parsed.expiresAt !== "number"
      ) {
        return null;
      }
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: parsed.expiresAt,
        accountLabel: typeof parsed.accountLabel === "string" ? parsed.accountLabel : undefined,
      };
    } catch {
      return null;
    }
  };

  const loadCredential = async (providerId: string): Promise<ProviderCredentialValue | null> => {
    const record = await options.storage.get({
      providerId,
      profileId: options.profileId,
    });
    if (!record) return null;

    if (record.kind === "oauth") {
      const parsed = parseOAuthSecret(record.secret);
      if (!parsed) return null;
      return { kind: "oauth", oauth: parsed };
    }

    return { kind: "token", token: record.secret };
  };

  return {
    async setToken(input) {
      await options.storage.set({
        providerId: input.providerId,
        profileId: options.profileId,
        kind: "token",
        secret: input.token,
        updatedAt: new Date().toISOString(),
      });
    },

    async setOAuth(input) {
      const payload: OAuthCredentialValue = {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt,
        accountLabel: input.accountLabel,
      };
      await options.storage.set({
        providerId: input.providerId,
        profileId: options.profileId,
        kind: "oauth",
        secret: JSON.stringify(payload),
        updatedAt: new Date().toISOString(),
      });
    },

    async clear(providerId) {
      await options.storage.remove({
        providerId,
        profileId: options.profileId,
      });
    },

    async getState(providerId) {
      const record = await options.storage.get({ providerId, profileId: options.profileId });
      const credential = await loadCredential(providerId);

      return {
        providerId,
        status: record ? "connected" : "disconnected",
        method: record?.kind ?? "token",
        accountLabel: credential?.kind === "oauth" ? (credential.oauth.accountLabel ?? null) : null,
        updatedAt: record?.updatedAt ?? new Date().toISOString(),
      };
    },

    async getCredential(providerId) {
      return loadCredential(providerId);
    },
  };
}
