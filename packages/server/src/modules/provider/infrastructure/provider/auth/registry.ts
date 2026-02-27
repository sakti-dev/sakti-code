import type { ProviderAuthMethodDescriptor } from "../types";
import type { ProviderAuthDefinition, ProviderAuthMethodDefinition } from "./definition";
import { createBuiltinProviderAuthDefinitions } from "./providers";

interface ProviderAuthRegistryState {
  definitions: Map<string, ProviderAuthDefinition>;
}

let state: ProviderAuthRegistryState | null = null;

function getState(): ProviderAuthRegistryState {
  if (state) return state;
  state = {
    definitions: new Map(
      createBuiltinProviderAuthDefinitions().map(definition => [definition.providerId, definition])
    ),
  };
  return state;
}

function defaultMethods(): ProviderAuthMethodDefinition[] {
  return [
    {
      type: "api",
      label: "API Key",
    },
  ];
}

function normalizeMethodType(
  input: ProviderAuthMethodDefinition["type"]
): "api" | "oauth" | "none" {
  if (input === "oauth") return "oauth";
  if (input === "api" || input === "token") return "api";
  return "none";
}

function normalizeMethod(method: ProviderAuthMethodDefinition): ProviderAuthMethodDescriptor {
  return {
    type: normalizeMethodType(method.type),
    label: method.label,
    prompts: method.prompts,
  };
}

export function listProviderAuthMethods(
  providerIds: string[]
): Record<string, ProviderAuthMethodDescriptor[]> {
  const registry = getState();
  return Object.fromEntries(
    providerIds.map(providerId => {
      const definition = registry.definitions.get(providerId);
      const methods = definition?.methods ?? defaultMethods();
      return [providerId, methods.map(normalizeMethod)] as const;
    })
  );
}

export function getProviderAuthMethods(providerId: string): ProviderAuthMethodDefinition[] {
  const registry = getState();
  const definition = registry.definitions.get(providerId);
  return definition?.methods ?? defaultMethods();
}

export function getProviderAuthDefinition(providerId: string): ProviderAuthDefinition | null {
  const registry = getState();
  return registry.definitions.get(providerId) ?? null;
}

export function resetProviderAuthRegistryForTests() {
  state = null;
}
