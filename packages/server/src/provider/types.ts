import type { z } from "zod";
import type {
  modelDescriptorSchema,
  providerAuthMethodDescriptorSchema,
  providerAuthMethodSchema,
  providerAuthStateSchema,
  providerConfigPayloadSchema,
  providerDescriptorSchema,
  providerOAuthAuthorizeResponseSchema,
  providerOAuthCallbackResponseSchema,
} from "./schema";

export type ProviderAuthMethod = z.infer<typeof providerAuthMethodSchema>;
export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;
export type ProviderAuthState = z.infer<typeof providerAuthStateSchema>;
export type ProviderAuthMethodDescriptor = z.infer<typeof providerAuthMethodDescriptorSchema>;
export type ProviderOAuthAuthorizeResponse = z.infer<typeof providerOAuthAuthorizeResponseSchema>;
export type ProviderOAuthCallbackResponse = z.infer<typeof providerOAuthCallbackResponseSchema>;
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>;
export type ProviderConfigPayload = z.infer<typeof providerConfigPayloadSchema>;
