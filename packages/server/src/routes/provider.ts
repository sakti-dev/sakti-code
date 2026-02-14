/**
 * Provider API Routes
 *
 * GET /api/providers - List available LLM providers
 * GET /api/providers/auth - Get auth state for providers
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../index";
import { completeOAuth, startOAuth } from "../provider/auth/oauth";
import { normalizeProviderError } from "../provider/errors";
import { listProviderDescriptors, resolveProviderAdapter } from "../provider/registry";
import { getProviderRuntime } from "../provider/runtime";
import { providerAuthStateSchema, providerDescriptorSchema } from "../provider/schema";

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

  return c.json(startOAuth(providerId));
});

providerRouter.post("/api/providers/:providerId/oauth/callback", async c => {
  const providerId = c.req.param("providerId");
  const adapter = resolveProviderAdapter(providerId);
  if (!adapter) {
    const normalized = normalizeProviderError(new Error("Provider not found"));
    return c.json(normalized, normalized.status);
  }

  completeOAuth(providerId);
  return c.json({ ok: true });
});

export default providerRouter;
