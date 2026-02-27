import { z } from "zod";

export const providerAuthPromptTextSchema = z.object({
  type: z.literal("text"),
  key: z.string().min(1),
  message: z.string().min(1),
  placeholder: z.string().optional(),
});

export const providerAuthPromptSelectSchema = z.object({
  type: z.literal("select"),
  key: z.string().min(1),
  message: z.string().min(1),
  options: z.array(
    z.object({
      label: z.string().min(1),
      value: z.string().min(1),
      hint: z.string().optional(),
    })
  ),
});

export const providerAuthMethodSchema = z.enum(["api", "token", "oauth", "none"]);
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
  prompts: z
    .array(z.union([providerAuthPromptTextSchema, providerAuthPromptSelectSchema]))
    .optional(),
});

export const providerCatalogItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  authMethods: z.array(providerAuthMethodDescriptorSchema),
  connected: z.boolean(),
  modelCount: z.number().int().nonnegative(),
  popular: z.boolean(),
  supported: z.boolean().optional(),
  note: z.string().optional(),
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

export const providerPreferencesSchema = z.object({
  selectedProviderId: z.string().nullable(),
  selectedModelId: z.string().nullable(),
  hybridEnabled: z.boolean().default(true),
  hybridVisionProviderId: z.string().nullable().default(null),
  hybridVisionModelId: z.string().nullable().default(null),
  updatedAt: z.string(),
});

export const providerPreferencesUpdateSchema = z.object({
  selectedProviderId: z.string().nullable().optional(),
  selectedModelId: z.string().nullable().optional(),
  hybridEnabled: z.boolean().optional(),
  hybridVisionProviderId: z.string().nullable().optional(),
  hybridVisionModelId: z.string().nullable().optional(),
});

const modelModalitiesSchema = z.object({
  input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
  output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
});

export const modelDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  providerApiUrl: z.string().url().optional(),
  providerNpmPackage: z.string().min(1).optional(),
  providerEnvVars: z.array(z.string().min(1)).optional(),
  contextWindow: z.number().int().nonnegative(),
  maxOutputTokens: z.number().int().nonnegative(),
  modalities: modelModalitiesSchema.optional(),
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
