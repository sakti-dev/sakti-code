import { z } from "zod";

export const providerAuthMethodSchema = z.enum(["token", "oauth", "none"]);

export const providerDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  env: z.array(z.string()).default([]),
  api: z.boolean().default(false),
  models: z.boolean().default(false),
  auth: z.object({
    kind: z.enum(["token", "oauth", "none"]),
  }),
});

export const providerAuthStateSchema = z.object({
  providerId: z.string().min(1),
  status: z.enum(["connected", "disconnected", "error", "oauth_required"]),
  method: providerAuthMethodSchema,
  accountLabel: z.string().nullable(),
  updatedAt: z.string(),
});

export const modelDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  contextWindow: z.number().int().nonnegative(),
  maxOutputTokens: z.number().int().nonnegative(),
  capabilities: z.object({
    text: z.boolean(),
    vision: z.boolean(),
    tools: z.boolean(),
    reasoning: z.boolean(),
    plan: z.boolean(),
  }),
});

export const providerConfigPayloadSchema = z.object({
  providers: z.array(providerDescriptorSchema),
  auth: z.record(z.string(), providerAuthStateSchema),
  models: z.array(modelDescriptorSchema),
});
