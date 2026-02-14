import type { ModelDescriptor, ProviderAuthState, ProviderDescriptor } from "../types";

export interface SetProviderCredentialInput {
  token: string;
}

export interface ProviderAdapter {
  id: string;
  describe(): ProviderDescriptor;
  listModels(): Promise<ModelDescriptor[]>;
  getAuthState(): Promise<ProviderAuthState>;
  setCredential(input: SetProviderCredentialInput): Promise<void>;
  clearCredential(): Promise<void>;
}
