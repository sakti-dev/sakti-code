import { mkdir } from "node:fs/promises";
import { createStorage } from "unstorage";
import fsLiteDriver from "unstorage/drivers/fs-lite";

export interface ProviderPreferences {
  selectedProviderId: string | null;
  selectedModelId: string | null;
  hybridEnabled: boolean;
  hybridVisionProviderId: string | null;
  hybridVisionModelId: string | null;
  updatedAt: string;
}

export interface ProviderPreferenceServiceOptions {
  baseDir: string;
  profileId: string;
}

export interface ProviderPreferenceService {
  get(): Promise<ProviderPreferences>;
  set(
    input: Partial<
      Pick<
        ProviderPreferences,
        | "selectedProviderId"
        | "selectedModelId"
        | "hybridEnabled"
        | "hybridVisionProviderId"
        | "hybridVisionModelId"
      >
    >
  ): Promise<ProviderPreferences>;
}

function keyFor(profileId: string): string {
  return `profiles/${profileId}/preferences`;
}

function defaultPreferences(): ProviderPreferences {
  return {
    selectedProviderId: null,
    selectedModelId: null,
    hybridEnabled: true,
    hybridVisionProviderId: null,
    hybridVisionModelId: null,
    updatedAt: new Date().toISOString(),
  };
}

export function createProviderPreferenceService(
  options: ProviderPreferenceServiceOptions
): ProviderPreferenceService {
  const storage = createStorage({
    driver: fsLiteDriver({ base: options.baseDir }),
  });
  let ensuredBaseDir = false;

  async function ensureBaseDir() {
    if (ensuredBaseDir) return;
    await mkdir(options.baseDir, { recursive: true, mode: 0o700 });
    ensuredBaseDir = true;
  }

  return {
    async get() {
      await ensureBaseDir();
      const data = await storage.getItem<ProviderPreferences>(keyFor(options.profileId));
      if (!data) return defaultPreferences();
      return {
        selectedProviderId:
          typeof data.selectedProviderId === "string" ? data.selectedProviderId : null,
        selectedModelId: typeof data.selectedModelId === "string" ? data.selectedModelId : null,
        hybridEnabled: typeof data.hybridEnabled === "boolean" ? data.hybridEnabled : true,
        hybridVisionProviderId:
          typeof data.hybridVisionProviderId === "string" ? data.hybridVisionProviderId : null,
        hybridVisionModelId:
          typeof data.hybridVisionModelId === "string" ? data.hybridVisionModelId : null,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
      };
    },
    async set(input) {
      await ensureBaseDir();
      const prev = await this.get();
      const next: ProviderPreferences = {
        selectedProviderId:
          input.selectedProviderId === undefined
            ? prev.selectedProviderId
            : input.selectedProviderId,
        selectedModelId:
          input.selectedModelId === undefined ? prev.selectedModelId : input.selectedModelId,
        hybridEnabled: input.hybridEnabled === undefined ? prev.hybridEnabled : input.hybridEnabled,
        hybridVisionProviderId:
          input.hybridVisionProviderId === undefined
            ? prev.hybridVisionProviderId
            : input.hybridVisionProviderId,
        hybridVisionModelId:
          input.hybridVisionModelId === undefined
            ? prev.hybridVisionModelId
            : input.hybridVisionModelId,
        updatedAt: new Date().toISOString(),
      };
      await storage.setItem(keyFor(options.profileId), next);
      return next;
    },
  };
}
