/**
 * Provider API Routes
 *
 * GET /api/providers - List available LLM providers
 * GET /api/providers/auth - Get auth state for providers
 */

import { resolveAppPaths } from "@ekacode/shared/paths";
import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Env } from "../index";
import { completeOAuth, startOAuth } from "../provider/auth/oauth";
import { createProviderAuthService } from "../provider/auth/service";
import { createModelCatalogService } from "../provider/models/catalog";
import {
  createProviderRegistry,
  listProviderDescriptors,
  resolveProviderAdapter,
} from "../provider/registry";
import { providerAuthStateSchema, providerDescriptorSchema } from "../provider/schema";
import { createProviderCredentialStorage } from "../provider/storage";

const providerRouter = new Hono<Env>();
const setTokenBodySchema = z.object({
  token: z.string().min(1),
});

const providerRegistry = createProviderRegistry();
const appPaths = resolveAppPaths({
  mode: "dev",
  cwd: process.cwd(),
  env: process.env,
});
const credentialBaseDir = join(appPaths.state, "provider-credentials");
mkdirSync(credentialBaseDir, { recursive: true });

const credentialStorage = createProviderCredentialStorage({
  baseDir: credentialBaseDir,
});
const providerAuthService = createProviderAuthService({
  storage: credentialStorage,
  profileId: "default",
});
const modelCatalogService = createModelCatalogService({
  adapters: Array.from(providerRegistry.adapters.values()),
});

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
      const state = await providerAuthService.getState(provider.id);
      return [provider.id, providerAuthStateSchema.parse(state)] as const;
    })
  );

  return c.json(Object.fromEntries(authStates));
});

providerRouter.get("/api/providers/models", async c => {
  const models = await modelCatalogService.list();
  return c.json({ models });
});

providerRouter.post("/api/providers/:providerId/auth/token", async c => {
  const providerId = c.req.param("providerId");
  const adapter = resolveProviderAdapter(providerId);
  if (!adapter) {
    return c.json({ error: "Provider not found" }, 404);
  }

  const body = setTokenBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) {
    return c.json({ error: "Invalid token payload" }, 400);
  }

  await providerAuthService.setToken({
    providerId,
    token: body.data.token,
  });

  return c.json({ ok: true });
});

providerRouter.delete("/api/providers/:providerId/auth/token", async c => {
  const providerId = c.req.param("providerId");
  const adapter = resolveProviderAdapter(providerId);
  if (!adapter) {
    return c.json({ error: "Provider not found" }, 404);
  }

  await providerAuthService.clear(providerId);

  return c.json({ ok: true });
});

providerRouter.post("/api/providers/:providerId/oauth/authorize", async c => {
  const providerId = c.req.param("providerId");
  const adapter = resolveProviderAdapter(providerId);
  if (!adapter) {
    return c.json({ error: "Provider not found" }, 404);
  }

  return c.json(startOAuth(providerId));
});

providerRouter.post("/api/providers/:providerId/oauth/callback", async c => {
  const providerId = c.req.param("providerId");
  const adapter = resolveProviderAdapter(providerId);
  if (!adapter) {
    return c.json({ error: "Provider not found" }, 404);
  }

  completeOAuth(providerId);
  return c.json({ ok: true });
});

export default providerRouter;
