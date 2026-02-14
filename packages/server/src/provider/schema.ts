import { z } from "zod";

export const providerAuthMethodSchema = z.enum(["token", "oauth", "none"]);
export const providerOAuthFlowMethodSchema = z.enum(["auto", "code"]);

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

export const providerAuthMethodDescriptorSchema = z.object({
  type: providerAuthMethodSchema,
  label: z.string().min(1),
});

export const providerOAuthAuthorizeRequestSchema = z.object({
  method: z.number().int().nonnegative(),
  inputs: z.record(z.string(), z.unknown()).optional(),
});

export const providerOAuthAuthorizeResponseSchema = z.object({
  providerId: z.string().min(1),
  authorizationId: z.string().min(1),
  url: z.string().min(1),
  method: providerOAuthFlowMethodSchema,
  instructions: z.string().min(1),
});

export const providerOAuthCallbackRequestSchema = z.object({
  method: z.number().int().nonnegative(),
  authorizationId: z.string().min(1),
  code: z.string().optional(),
});

export const providerOAuthCallbackResponseSchema = z.object({
  status: z.enum(["pending", "connected"]),
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
