/**
 * Provider API Routes
 *
 * GET /api/providers - List available LLM providers
 * GET /api/providers/auth - Get auth state for providers
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../index";
import { completeOAuth, listProviderAuthMethods, startOAuth } from "../provider/auth/oauth";
import { normalizeProviderError } from "../provider/errors";
import { listProviderDescriptors, resolveProviderAdapter } from "../provider/registry";
import { getProviderRuntime } from "../provider/runtime";
import {
  providerAuthStateSchema,
  providerDescriptorSchema,
  providerOAuthAuthorizeRequestSchema,
  providerOAuthCallbackRequestSchema,
} from "../provider/schema";

const providerRouter = new Hono<Env>();
const setTokenBodySchema = z.object({
  token: z.string().min(1),
});

const providerRuntime = getProviderRuntime();

/**
 * List available LLM providers
 */
providerRouter.get("/api/providers", async c => {
  const providers = listProviderDescriptors().map(provider =>
    providerDescriptorSchema.parse(provider)
  );

  return c.json({
    providers,
  });
});

/**
 * Get auth state for providers
 */
providerRouter.get("/api/providers/auth", async c => {
  const authStates = await Promise.all(
    listProviderDescriptors().map(async provider => {
      const state = await providerRuntime.authService.getState(provider.id);
      return [provider.id, providerAuthStateSchema.parse(state)] as const;
    })
  );

  return c.json(Object.fromEntries(authStates));
});

providerRouter.get("/api/providers/auth/methods", async c => {
  const providers = listProviderDescriptors();
  return c.json(listProviderAuthMethods(providers.map(provider => provider.id)));
});

providerRouter.get("/api/providers/models", async c => {
  const models = await providerRuntime.modelCatalogService.list();
  return c.json({ models });
});

providerRouter.post("/api/providers/:providerId/auth/token", async c => {
  const providerId = c.req.param("providerId");
  const adapter = resolveProviderAdapter(providerId);
  if (!adapter) {
    const normalized = normalizeProviderError(new Error("Provider not found"));
    return c.json(normalized, normalized.status);
  }

  const body = setTokenBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    const normalized = normalizeProviderError(new Error("Invalid token payload"));
    return c.json(normalized, normalized.status);
  }

  await providerRuntime.authService.setToken({
    providerId,
    token: body.data.token,
  });

  return c.json({ ok: true });
});

providerRouter.delete("/api/providers/:providerId/auth/token", async c => {
  const providerId = c.req.param("providerId");
  const adapter = resolveProviderAdapter(providerId);
  if (!adapter) {
    const normalized = normalizeProviderError(new Error("Provider not found"));
    return c.json(normalized, normalized.status);
  }

  await providerRuntime.authService.clear(providerId);

  return c.json({ ok: true });
});

providerRouter.post("/api/providers/:providerId/oauth/authorize", async c => {
  const providerId = c.req.param("providerId");
  const adapter = resolveProviderAdapter(providerId);
  if (!adapter) {
    const normalized = normalizeProviderError(new Error("Provider not found"));
    return c.json(normalized, normalized.status);
  }

  const body = providerOAuthAuthorizeRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    const normalized = normalizeProviderError(new Error("Invalid oauth authorize payload"));
    return c.json(normalized, normalized.status);
  }

  try {
    const result = await startOAuth({
      providerId,
      method: body.data.method,
      inputs: body.data.inputs,
    });
    return c.json(result);
  } catch (error) {
    const normalized = normalizeProviderError(error);
    return c.json(normalized, normalized.status);
  }
});

providerRouter.post("/api/providers/:providerId/oauth/callback", async c => {
  const providerId = c.req.param("providerId");
  const adapter = resolveProviderAdapter(providerId);
  if (!adapter) {
    const normalized = normalizeProviderError(new Error("Provider not found"));
    return c.json(normalized, normalized.status);
  }

  const body = providerOAuthCallbackRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    const normalized = normalizeProviderError(new Error("Invalid oauth callback payload"));
    return c.json(normalized, normalized.status);
  }

  try {
    const result = await completeOAuth(
      {
        providerId,
        method: body.data.method,
        authorizationId: body.data.authorizationId,
        code: body.data.code,
      },
      providerRuntime.authService
    );
    return c.json(result);
  } catch (error) {
    const normalized = normalizeProviderError(error);
    return c.json(normalized, normalized.status);
  }
});

export default providerRouter;
