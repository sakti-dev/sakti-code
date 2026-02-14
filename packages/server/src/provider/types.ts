import type { z } from "zod";
import type {
  modelDescriptorSchema,
  providerAuthMethodSchema,
  providerAuthStateSchema,
  providerConfigPayloadSchema,
  providerDescriptorSchema,
} from "./schema";

export type ProviderAuthMethod = z.infer<typeof providerAuthMethodSchema>;
export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;
export type ProviderAuthState = z.infer<typeof providerAuthStateSchema>;
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>;
export type ProviderConfigPayload = z.infer<typeof providerConfigPayloadSchema>;
