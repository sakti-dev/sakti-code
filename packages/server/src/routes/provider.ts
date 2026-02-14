/**
 * Provider API Routes
 *
 * GET /api/providers - List available LLM providers
 * GET /api/providers/auth - Get auth state for providers
 */

import { Hono } from "hono";
import type { Env } from "../index";
import { providerAuthStateSchema, providerDescriptorSchema } from "../provider/schema";

const providerRouter = new Hono<Env>();

/**
 * List available LLM providers
 */
providerRouter.get("/api/providers", async c => {
  // TODO: Implement actual provider listing from config
  // For now, return common providers validated by schema
  const providers = [
    providerDescriptorSchema.parse({
      id: "zai",
      name: "Z.ai",
      env: ["ZAI_API_KEY"],
      api: true,
      models: true,
      auth: { kind: "token" },
    }),
    providerDescriptorSchema.parse({
      id: "openai",
      name: "OpenAI",
      env: ["OPENAI_API_KEY"],
      api: true,
      models: true,
      auth: { kind: "token" },
    }),
    providerDescriptorSchema.parse({
      id: "anthropic",
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      api: true,
      models: true,
      auth: { kind: "token" },
    }),
  ];

  return c.json({
    providers,
  });
});

/**
 * Get auth state for providers
 */
providerRouter.get("/api/providers/auth", async c => {
  // TODO: Implement actual auth state checking
  // For now, return disconnected auth state
  return c.json({
    zai: providerAuthStateSchema.parse({
      providerId: "zai",
      status: "disconnected",
      method: "token",
      accountLabel: null,
      updatedAt: new Date().toISOString(),
    }),
  });
});

export default providerRouter;
