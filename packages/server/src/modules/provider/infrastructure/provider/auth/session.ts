import { randomUUID } from "node:crypto";
import type { OAuthCallbackResult } from "./definition";

interface OAuthPendingAuthorization {
  providerId: string;
  method: number;
  callback: (code?: string) => Promise<OAuthCallbackResult>;
  expiresAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;
const pending = new Map<string, OAuthPendingAuthorization>();

function cleanupExpiredPending(now = Date.now()) {
  for (const [authorizationId, value] of pending.entries()) {
    if (value.expiresAt <= now) {
      pending.delete(authorizationId);
    }
  }
}

export function createOAuthPendingAuthorization(input: {
  providerId: string;
  method: number;
  callback: (code?: string) => Promise<OAuthCallbackResult>;
}): string {
  cleanupExpiredPending();
  const authorizationId = randomUUID();
  pending.set(authorizationId, {
    providerId: input.providerId,
    method: input.method,
    callback: input.callback,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });
  return authorizationId;
}

export function findOAuthPendingAuthorization(input: {
  authorizationId: string;
  providerId: string;
  method: number;
}): OAuthPendingAuthorization | null {
  cleanupExpiredPending();
  const value = pending.get(input.authorizationId);
  if (!value) return null;
  if (value.providerId !== input.providerId || value.method !== input.method) {
    return null;
  }
  return value;
}

export function clearOAuthPendingAuthorization(authorizationId: string) {
  pending.delete(authorizationId);
}

export function resetOAuthPendingAuthorizationForTests() {
  pending.clear();
}
