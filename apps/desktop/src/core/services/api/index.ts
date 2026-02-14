/**
 * Infrastructure API Barrel Export
 *
 * Exports all API-related infrastructure utilities.
 * Part of Phase 6: Cleanup & Optimization
 */

export { createProviderClient } from "./provider-client";
export type {
  CreateProviderClientOptions,
  ProviderAuthState,
  ProviderClient,
  ProviderDescriptor,
  ProviderModel,
} from "./provider-client";
export { createSDKClient } from "./sdk-client";
export type {
  CreateSDKClientOptions,
  SDKClient,
  SessionInfo,
  SessionMessagesOptions,
  SessionMessagesResponse,
} from "./sdk-client";
