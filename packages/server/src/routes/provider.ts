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
import { buildProviderCatalog, collectKnownProviderIds } from "../provider/catalog";
import { normalizeProviderError } from "../provider/errors";
import { listProviderDescriptors } from "../provider/registry";
import { getProviderRuntime } from "../provider/runtime";
import {
  providerAuthStateSchema,
  providerCatalogItemSchema,
  providerDescriptorSchema,
  providerOAuthAuthorizeRequestSchema,
  providerOAuthCallbackRequestSchema,
  providerPreferencesUpdateSchema,
} from "../provider/schema";
import { zValidator } from "../shared/controller/http/validators.js";

const providerRouter = new Hono<Env>();
const setTokenBodySchema = z.object({
  token: z.string().min(1),
});

const providerIdParamSchema = z.object({
  providerId: z.string().min(1),
});

const providerRuntime = getProviderRuntime();

async function providerExists(providerId: string): Promise<boolean> {
  const providers = listProviderDescriptors();
  if (providers.some(provider => provider.id === providerId)) return true;

  const models = await providerRuntime.modelCatalogService.list();
  return models.some(model => model.providerId === providerId);
}

async function listKnownProviderDescriptors() {
  const descriptors = listProviderDescriptors();
  const byId = new Map(descriptors.map(provider => [provider.id, provider] as const));
  const models = await providerRuntime.modelCatalogService.list();

  for (const model of models) {
    if (byId.has(model.providerId)) continue;
    byId.set(model.providerId, {
      id: model.providerId,
      name: model.providerName || model.providerId,
      env: model.providerEnvVars ?? [],
      api: true,
      models: true,
      auth: { kind: "token" as const },
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List available LLM providers
 */
providerRouter.get("/api/providers", async c => {
  const providers = (await listKnownProviderDescriptors()).map(provider =>
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
  const providers = listProviderDescriptors();
  const models = await providerRuntime.modelCatalogService.list();
  const providerIds = Array.from(collectKnownProviderIds({ providers, models }));
  const authStates = await Promise.all(
    providerIds.map(async providerId => {
      const state = await providerRuntime.authService.getState(providerId);
      return [providerId, providerAuthStateSchema.parse(state)] as const;
    })
  );

  return c.json(Object.fromEntries(authStates));
});

providerRouter.get("/api/providers/catalog", async c => {
  const providers = listProviderDescriptors();
  const models = await providerRuntime.modelCatalogService.list();
  const catalog = await buildProviderCatalog({
    providers,
    models,
    authService: providerRuntime.authService,
  });
  return c.json({
    providers: catalog.map(item => providerCatalogItemSchema.parse(item)),
  });
});

providerRouter.get("/api/providers/auth/methods", async c => {
  const providers = listProviderDescriptors();
  const models = await providerRuntime.modelCatalogService.list();
  const providerIds = Array.from(collectKnownProviderIds({ providers, models }));
  return c.json(listProviderAuthMethods(providerIds));
});

providerRouter.get("/api/providers/models", async c => {
  const models = await providerRuntime.modelCatalogService.list();
  return c.json({ models });
});

providerRouter.get("/api/providers/preferences", async c => {
  const preferences = await providerRuntime.preferenceService.get();
  return c.json(preferences);
});

providerRouter.put(
  "/api/providers/preferences",
  zValidator("json", providerPreferencesUpdateSchema),
  async c => {
    const body = c.req.valid("json");
    const preferences = await providerRuntime.preferenceService.set({
      selectedProviderId: body.selectedProviderId,
      selectedModelId: body.selectedModelId,
      hybridEnabled: body.hybridEnabled,
      hybridVisionProviderId: body.hybridVisionProviderId,
      hybridVisionModelId: body.hybridVisionModelId,
    });
    return c.json(preferences);
  }
);

providerRouter.post(
  "/api/providers/:providerId/auth/token",
  zValidator("param", providerIdParamSchema),
  zValidator("json", setTokenBodySchema),
  async c => {
    const { providerId } = c.req.valid("param");
    const exists = await providerExists(providerId);
    if (!exists) {
      const normalized = normalizeProviderError(new Error("Provider not found"));
      return c.json(normalized, normalized.status);
    }

    const body = c.req.valid("json");

    await providerRuntime.authService.setToken({
      providerId,
      token: body.token,
    });

    return c.json({ ok: true });
  }
);

providerRouter.delete(
  "/api/providers/:providerId/auth/token",
  zValidator("param", providerIdParamSchema),
  async c => {
    const { providerId } = c.req.valid("param");
    const exists = await providerExists(providerId);
    if (!exists) {
      const normalized = normalizeProviderError(new Error("Provider not found"));
      return c.json(normalized, normalized.status);
    }

    await providerRuntime.authService.clear(providerId);

    return c.json({ ok: true });
  }
);

providerRouter.post(
  "/api/providers/:providerId/oauth/authorize",
  zValidator("param", providerIdParamSchema),
  zValidator("json", providerOAuthAuthorizeRequestSchema),
  async c => {
    const { providerId } = c.req.valid("param");
    const exists = await providerExists(providerId);
    if (!exists) {
      const normalized = normalizeProviderError(new Error("Provider not found"));
      return c.json(normalized, normalized.status);
    }

    const body = c.req.valid("json");

    try {
      const result = await startOAuth({
        providerId,
        method: body.method,
        inputs: body.inputs,
      });
      return c.json(result);
    } catch (error) {
      const normalized = normalizeProviderError(error);
      return c.json(normalized, normalized.status);
    }
  }
);

providerRouter.post(
  "/api/providers/:providerId/oauth/callback",
  zValidator("param", providerIdParamSchema),
  zValidator("json", providerOAuthCallbackRequestSchema),
  async c => {
    const { providerId } = c.req.valid("param");
    const exists = await providerExists(providerId);
    if (!exists) {
      const normalized = normalizeProviderError(new Error("Provider not found"));
      return c.json(normalized, normalized.status);
    }

    const body = c.req.valid("json");

    try {
      const result = await completeOAuth(
        {
          providerId,
          method: body.method,
          authorizationId: body.authorizationId,
          code: body.code,
        },
        providerRuntime.authService
      );
      return c.json(result);
    } catch (error) {
      const normalized = normalizeProviderError(error);
      return c.json(normalized, normalized.status);
    }
  }
);

export default providerRouter;
