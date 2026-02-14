import { resolveAppPaths } from "@ekacode/shared/paths";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createProviderAuthService } from "./auth/service";
import { ensureCredentialProfileBootstrapSync } from "./bootstrap";
import { createModelCatalogService } from "./models/catalog";
import { createProviderRegistry } from "./registry";
import { createProviderCredentialStorage } from "./storage";

export interface ChatSelection {
  providerId: string;
  modelId: string;
  explicit: boolean;
}

export interface ProviderRuntime {
  registry: ReturnType<typeof createProviderRegistry>;
  authService: ReturnType<typeof createProviderAuthService>;
  modelCatalogService: ReturnType<typeof createModelCatalogService>;
}

let runtime: ProviderRuntime | null = null;

function defaultModelForProvider(providerId: string): string {
  switch (providerId) {
    case "zai":
      return "zai/glm-4.7";
    default:
      return `${providerId}/default`;
  }
}

export function resolveChatSelection(input: {
  providerId?: unknown;
  modelId?: unknown;
}): ChatSelection {
  const explicit = typeof input.providerId === "string" || typeof input.modelId === "string";

  const providerId =
    typeof input.providerId === "string" && input.providerId.trim().length > 0
      ? input.providerId.trim().toLowerCase()
      : "zai";

  const modelId =
    typeof input.modelId === "string" && input.modelId.trim().length > 0
      ? input.modelId.trim()
      : defaultModelForProvider(providerId);

  return {
    providerId,
    modelId,
    explicit,
  };
}

export function hasProviderEnvironmentCredential(providerId: string): boolean {
  const envName = providerCredentialEnvVar(providerId);
  return envName ? Boolean(process.env[envName]) : false;
}

export function providerCredentialEnvVar(providerId: string): string | null {
  switch (providerId) {
    case "zai":
      return "ZAI_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    default:
      return null;
  }
}

export function getProviderRuntime(): ProviderRuntime {
  if (runtime) {
    return runtime;
  }

  const appPaths = resolveAppPaths({
    mode: "dev",
    cwd: process.cwd(),
    env: process.env,
  });

  const credentialBaseDir = join(appPaths.state, "provider-credentials");
  mkdirSync(credentialBaseDir, { recursive: true, mode: 0o700 });
  ensureCredentialProfileBootstrapSync(credentialBaseDir, "default");

  const registry = createProviderRegistry();
  const storage = createProviderCredentialStorage({
    baseDir: credentialBaseDir,
  });
  const authService = createProviderAuthService({
    storage,
    profileId: "default",
  });
  const modelCatalogService = createModelCatalogService({
    adapters: Array.from(registry.adapters.values()),
  });

  runtime = {
    registry,
    authService,
    modelCatalogService,
  };

  return runtime;
}

export function resetProviderRuntimeForTests() {
  runtime = null;
}
