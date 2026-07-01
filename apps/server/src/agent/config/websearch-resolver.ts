import {
  buildExaOperations,
  buildTavilyOperations,
  type SearchOperations,
} from "@sakti-code/tools";
import type { AuthStore } from "../../lib/auth-store.ts";
import type { SettingsFileStore } from "../../lib/settings-file-store.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve the active websearch adapter from settings.json (provider) and the
 * matching key in auth.json (namespaced `websearch:<provider>`). Returns
 * `undefined` when the provider is absent/unknown or has no stored key — in
 * that case the tool is built without operations and surfaces an actionable
 * "not configured" error if the agent calls it. This is the only module that
 * imports the adapter builders.
 */
export function resolveWebSearchOperations(
  auth: AuthStore,
  settingsFile: SettingsFileStore,
): SearchOperations | undefined {
  const raw = settingsFile.read().websearch;
  const cfg = isPlainObject(raw) ? raw : undefined;
  const providerRaw = cfg?.provider;
  const provider = typeof providerRaw === "string" ? providerRaw : undefined;

  if (provider === "exa") {
    const key = auth.getApiKey("websearch:exa");
    return key ? buildExaOperations(key) : undefined;
  }
  if (provider === "tavily") {
    const key = auth.getApiKey("websearch:tavily");
    return key ? buildTavilyOperations(key) : undefined;
  }
  return undefined;
}
