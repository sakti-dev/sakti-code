import type {
  ProviderAuthState,
  ProviderClient,
  ProviderDescriptor,
  ProviderModel,
  ProviderPreferences,
} from "@/core/services/api/provider-client";
import MiniSearch from "minisearch";
import { createEffect, createMemo, createResource } from "solid-js";

export interface ProviderSelectionModelDoc {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  connected: boolean;
  keywords: string;
  searchableText: string;
  searchableLoose: string;
}

interface ProviderSelectionData {
  providers: ProviderDescriptor[];
  auth: Record<string, ProviderAuthState>;
  models: ProviderModel[];
  preferences: ProviderPreferences;
}

function toModelDoc(
  model: ProviderModel,
  auth: Record<string, ProviderAuthState>,
  providersById: Record<string, ProviderDescriptor>
): ProviderSelectionModelDoc {
  const provider = providersById[model.providerId];
  const aliasTerms = getProviderAliasTerms(model.providerId, provider?.name);
  const keywords =
    `${model.id} ${model.name ?? ""} ${model.providerId} ${provider?.name ?? model.providerName ?? ""} ${aliasTerms.join(" ")}`.trim();
  return {
    id: model.id,
    name: model.name ?? model.id,
    providerId: model.providerId,
    providerName: provider?.name ?? model.providerName ?? model.providerId,
    connected: auth[model.providerId]?.status === "connected",
    keywords,
    searchableText: keywords.toLowerCase(),
    searchableLoose: toLooseSearchText(keywords),
  };
}

function getProviderAliasTerms(providerId: string, providerName?: string): string[] {
  const normalizedId = providerId.trim().toLowerCase();
  const terms = new Set<string>([normalizedId]);
  if (providerName) terms.add(providerName.toLowerCase());

  if (normalizedId === "zai") {
    terms.add("z.ai");
    terms.add("z ai");
    terms.add("zen");
    terms.add("opencode zen");
    terms.add("z.ai coding plan");
    terms.add("zai coding plan");
    terms.add("zai-coding-plan");
  }

  if (normalizedId === "zai-coding-plan") {
    terms.add("zai");
    terms.add("zai coding plan");
    terms.add("z.ai coding plan");
    terms.add("zen");
  }

  if (normalizedId === "moonshot") {
    terms.add("kimi");
  }

  return Array.from(terms);
}

function toLooseSearchText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreModelMatch(
  model: ProviderSelectionModelDoc,
  normalizedQuery: string,
  looseQuery: string,
  providerFocusedIds: Set<string>
): number {
  const name = model.name.toLowerCase();
  const id = model.id.toLowerCase();
  const providerId = model.providerId.toLowerCase();
  const providerName = model.providerName.toLowerCase();
  const idSuffix = id.includes("/") ? (id.split("/").pop() ?? id) : id;
  const slashCount = (id.match(/\//g) ?? []).length;
  const focused = providerFocusedIds.has(model.providerId);

  let score = 0;

  if (focused) score += 220;
  if (providerId === normalizedQuery) score += 900;
  if (providerName === normalizedQuery) score += 850;
  if (name === normalizedQuery) score += 800;
  if (id === normalizedQuery || idSuffix === normalizedQuery) score += 780;

  if (providerId.startsWith(normalizedQuery)) score += 320;
  if (providerName.startsWith(normalizedQuery)) score += 280;
  if (name.startsWith(normalizedQuery)) score += 260;
  if (idSuffix.startsWith(normalizedQuery)) score += 240;
  if (id.startsWith(normalizedQuery)) score += 220;

  if (name.includes(normalizedQuery)) score += 170;
  if (idSuffix.includes(normalizedQuery)) score += 160;
  if (id.includes(normalizedQuery)) score += 140;
  if (model.searchableLoose.includes(looseQuery)) score += 120;
  if (model.searchableText.includes(normalizedQuery)) score += 100;
  if (idSuffix === normalizedQuery) score += Math.max(0, 40 - slashCount * 10);

  if (model.connected) score += 10;

  return score;
}

function rankModels(
  input: ProviderSelectionModelDoc[],
  normalizedQuery: string,
  providerFocusedIds: Set<string>
): ProviderSelectionModelDoc[] {
  const looseQuery = toLooseSearchText(normalizedQuery);
  return [...input].sort((a, b) => {
    const scoreDelta =
      scoreModelMatch(b, normalizedQuery, looseQuery, providerFocusedIds) -
      scoreModelMatch(a, normalizedQuery, looseQuery, providerFocusedIds);
    if (scoreDelta !== 0) return scoreDelta;
    const nameDelta = a.name.localeCompare(b.name);
    if (nameDelta !== 0) return nameDelta;
    return a.id.localeCompare(b.id);
  });
}

export function createProviderSelectionStore(client: ProviderClient) {
  const DEBUG_PREFIX = "[model-selector-debug]";
  const [data, { refetch, mutate }] = createResource<ProviderSelectionData>(async () => {
    const [providers, auth, models, preferences] = await Promise.all([
      client.listProviders(),
      client.listAuthStates(),
      client.listModels(),
      client.getPreferences(),
    ]);
    return { providers, auth, models, preferences };
  });

  const docs = createMemo<ProviderSelectionModelDoc[]>(() => {
    const current = data();
    if (!current) return [];
    const providersById = Object.fromEntries(
      current.providers.map(provider => [provider.id, provider] as const)
    );
    return current.models.map(model => toModelDoc(model, current.auth, providersById));
  });
  const providerAliasesById = createMemo(() => {
    const current = data();
    if (!current) return new Map<string, string[]>();
    const aliases = new Map<string, string[]>();
    const providersById = new Map(
      current.providers.map(provider => [provider.id, provider.name] as const)
    );
    for (const provider of current.providers) {
      aliases.set(provider.id, getProviderAliasTerms(provider.id, provider.name));
    }
    for (const model of current.models) {
      if (aliases.has(model.providerId)) continue;
      aliases.set(
        model.providerId,
        getProviderAliasTerms(
          model.providerId,
          providersById.get(model.providerId) ?? model.providerId
        )
      );
    }
    return aliases;
  });

  const index = createMemo(() => {
    const mini = new MiniSearch<ProviderSelectionModelDoc>({
      idField: "id",
      fields: ["name", "id", "providerId", "keywords"],
      storeFields: [
        "id",
        "name",
        "providerId",
        "providerName",
        "connected",
        "keywords",
        "searchableText",
      ],
      searchOptions: {
        prefix: true,
        fuzzy: 0.2,
        boost: { name: 2 },
      },
    });
    mini.addAll(docs());
    return mini;
  });

  const searchCache = new Map<string, ProviderSelectionModelDoc[]>();
  const connectedCache = new Map<string, ProviderSelectionModelDoc[]>();
  const notConnectedCache = new Map<string, ProviderSelectionModelDoc[]>();
  const groupedCache = new Map<
    string,
    Array<{
      providerId: string;
      providerName: string;
      connected: boolean;
      models: ProviderSelectionModelDoc[];
    }>
  >();

  const clearCaches = () => {
    searchCache.clear();
    connectedCache.clear();
    notConnectedCache.clear();
    groupedCache.clear();
  };

  createEffect(() => {
    docs();
    clearCaches();
  });

  const normalizeQuery = (query: string) => query.trim().toLowerCase();
  const expandQueryTerms = (query: string): string[] => {
    const normalized = normalizeQuery(query);
    if (!normalized) return [];

    const terms = new Set<string>([normalized]);
    if (normalized === "zen" || normalized === "opencode zen") {
      terms.add("zai");
      terms.add("z.ai");
    }
    if (normalized.includes("zai-coding-plan"))
      terms.add(normalized.replaceAll("zai-coding-plan", "zai coding plan"));
    if (normalized.includes("z.ai")) terms.add(normalized.replaceAll("z.ai", "zai"));
    if (normalized.includes("z ai")) terms.add(normalized.replaceAll("z ai", "zai"));
    if (normalized.includes("kimi")) terms.add(normalized.replaceAll("kimi", "moonshot"));
    terms.add(toLooseSearchText(normalized));

    return Array.from(terms);
  };

  const search = (query: string): ProviderSelectionModelDoc[] => {
    const normalized = normalizeQuery(query);
    const cached = searchCache.get(normalized);
    if (cached) return cached;

    if (!normalized) {
      const allDocs = docs();
      searchCache.set(normalized, allDocs);
      return allDocs;
    }

    const byId = new Map<string, ProviderSelectionModelDoc>();
    const searchTerms = expandQueryTerms(normalized);
    const docsValue = docs();
    const providerFocusedIds = new Set<string>();
    const looseQuery = toLooseSearchText(normalized);

    for (const [providerId, aliases] of providerAliasesById()) {
      const aliasMatched = aliases.some(alias => {
        const looseAlias = toLooseSearchText(alias);
        return (
          looseAlias === looseQuery ||
          looseAlias.startsWith(`${looseQuery} `) ||
          looseAlias.startsWith(`${looseQuery}-`)
        );
      });
      if (aliasMatched) {
        providerFocusedIds.add(providerId);
      }
    }

    const strictMatches = docsValue.filter(model =>
      searchTerms.some(
        term =>
          model.searchableText.includes(term) ||
          model.searchableLoose.includes(toLooseSearchText(term))
      )
    );

    if (strictMatches.length > 0) {
      const rankedStrict = rankModels(strictMatches, normalized, providerFocusedIds);
      searchCache.set(normalized, rankedStrict);
      return rankedStrict;
    }

    for (const term of searchTerms) {
      const exactHits = index()
        .search(term, {
          prefix: true,
          fuzzy: false,
          boost: { name: 2 },
        })
        .map(hit => ({
          id: String(hit.id),
          name: String(hit.name ?? hit.id),
          providerId: String(hit.providerId),
          providerName: String(hit.providerName ?? hit.providerId),
          connected: Boolean(hit.connected),
          keywords: String(hit.keywords ?? ""),
          searchableText: String(hit.searchableText ?? "").toLowerCase(),
          searchableLoose: toLooseSearchText(String(hit.searchableText ?? "")),
        }));

      for (const hit of exactHits) {
        if (!byId.has(hit.id)) byId.set(hit.id, hit);
      }
    }

    if (byId.size === 0) {
      for (const term of searchTerms) {
        if (term.length < 4) continue;
        const fuzzyHits = index()
          .search(term, {
            prefix: true,
            fuzzy: 0.2,
            boost: { name: 2 },
          })
          .map(hit => ({
            id: String(hit.id),
            name: String(hit.name ?? hit.id),
            providerId: String(hit.providerId),
            providerName: String(hit.providerName ?? hit.providerId),
            connected: Boolean(hit.connected),
            keywords: String(hit.keywords ?? ""),
            searchableText: String(hit.searchableText ?? "").toLowerCase(),
            searchableLoose: toLooseSearchText(String(hit.searchableText ?? "")),
          }));
        for (const hit of fuzzyHits) {
          if (!byId.has(hit.id)) byId.set(hit.id, hit);
        }
      }
    }

    for (const model of docsValue) {
      if (searchTerms.some(term => model.searchableText.includes(term)) && !byId.has(model.id)) {
        byId.set(model.id, model);
      }
    }

    const results = rankModels(Array.from(byId.values()), normalized, providerFocusedIds);
    searchCache.set(normalized, results);
    return results;
  };

  const allResults = (query: string) => search(query);

  const connectedResults = (query: string) => {
    const normalized = normalizeQuery(query);
    const cached = connectedCache.get(normalized);
    if (cached) return cached;
    const results = search(query).filter(model => model.connected);
    connectedCache.set(normalized, results);
    return results;
  };

  const notConnectedResults = (query: string) => {
    const normalized = normalizeQuery(query);
    const cached = notConnectedCache.get(normalized);
    if (cached) return cached;
    const results = search(query).filter(model => !model.connected);
    notConnectedCache.set(normalized, results);
    return results;
  };

  const providerGroupedSections = (query: string) => {
    const normalized = normalizeQuery(query);
    const cached = groupedCache.get(normalized);
    if (cached) return cached;

    const grouped = new Map<
      string,
      {
        providerId: string;
        providerName: string;
        connected: boolean;
        models: ProviderSelectionModelDoc[];
      }
    >();

    for (const model of search(query)) {
      const current = grouped.get(model.providerId);
      if (current) {
        current.models.push(model);
        current.connected = current.connected || model.connected;
        continue;
      }
      grouped.set(model.providerId, {
        providerId: model.providerId,
        providerName: model.providerName,
        connected: model.connected,
        models: [model],
      });
    }

    const sections = Array.from(grouped.values())
      .sort((a, b) => {
        if (a.connected !== b.connected) return a.connected ? -1 : 1;
        return a.providerName.localeCompare(b.providerName);
      })
      .map(section => ({
        providerId: section.providerId,
        providerName: section.providerName,
        connected: section.connected,
        models: section.models.sort((a, b) => a.name.localeCompare(b.name)),
      }));
    groupedCache.set(normalized, sections);
    return sections;
  };

  const setSelectedModel = async (modelId: string) => {
    const selected = docs().find(model => model.id === modelId);
    console.log(`${DEBUG_PREFIX} store:setSelectedModel:start`, {
      modelId,
      selectedProviderId: selected?.providerId ?? null,
      previousSelectedModelId: data()?.preferences.selectedModelId ?? null,
    });
    const previous = data();
    if (previous) {
      const optimistic = {
        ...previous,
        preferences: {
          ...previous.preferences,
          selectedModelId: modelId,
          selectedProviderId: selected?.providerId ?? null,
          updatedAt: new Date().toISOString(),
        },
      };
      console.log(`${DEBUG_PREFIX} store:setSelectedModel:optimistic`, {
        selectedModelId: optimistic.preferences.selectedModelId,
        selectedProviderId: optimistic.preferences.selectedProviderId,
      });
      mutate({
        ...optimistic,
      });
    }

    try {
      const persisted = await client.updatePreferences({
        selectedModelId: modelId,
        selectedProviderId: selected?.providerId ?? null,
      });
      console.log(`${DEBUG_PREFIX} store:setSelectedModel:updatePreferences:ok`, { modelId });
      const current = data();
      if (current) {
        mutate({
          ...current,
          preferences: persisted,
        });
      }
      console.log(`${DEBUG_PREFIX} store:setSelectedModel:persisted`, {
        selectedModelId: persisted.selectedModelId,
        selectedProviderId: persisted.selectedProviderId,
      });
    } catch (error) {
      if (previous) mutate(previous);
      console.error(`${DEBUG_PREFIX} store:setSelectedModel:error`, error, {
        rollbackSelectedModelId: previous?.preferences.selectedModelId ?? null,
        rollbackSelectedProviderId: previous?.preferences.selectedProviderId ?? null,
      });
      throw error;
    }
  };

  return {
    data,
    docs,
    refresh: refetch,
    allResults,
    connectedResults,
    notConnectedResults,
    providerGroupedSections,
    setSelectedModel,
  };
}

export type ProviderSelectionStore = ReturnType<typeof createProviderSelectionStore>;
