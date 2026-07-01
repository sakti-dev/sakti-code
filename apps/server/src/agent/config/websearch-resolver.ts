import {
  buildDdgOperations,
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
 * matching key in auth.json (namespaced `websearch:<provider>`). When the
 * chosen provider has no key, or the provider is absent/unknown, falls back to
 * the keyless DuckDuckGo adapter. This is the only module that imports all
 * three adapter builders.
 */
export function resolveWebSearchOperations(
  auth: AuthStore,
  settingsFile: SettingsFileStore,
): SearchOperations {
  const raw = settingsFile.read().websearch;
  const cfg = isPlainObject(raw) ? raw : undefined;
  const providerRaw = cfg?.provider;
  const provider = typeof providerRaw === "string" ? providerRaw : undefined;

  if (provider === "exa") {
    const key = auth.getApiKey("websearch:exa");
    return key ? buildExaOperations(key) : buildDdgOperations();
  }
  if (provider === "tavily") {
    const key = auth.getApiKey("websearch:tavily");
    return key ? buildTavilyOperations(key) : buildDdgOperations();
  }
  return buildDdgOperations();
}
