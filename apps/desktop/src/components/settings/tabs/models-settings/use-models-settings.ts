import { createMemo, createResource, createSignal } from "solid-js";
import type { Client } from "~/lib/api";
import { useStore } from "~/stores/store-context";

interface ProviderItem {
  connected: boolean;
  id: string;
  modelCount: number;
  name: string;
}

const EMPTY_PROVIDERS: ProviderItem[] = [];

async function setApiKey(
  client: Client,
  provider: string,
  key: string
): Promise<boolean> {
  try {
    const res = await client.api.auth[":provider"].$post({
      param: { provider },
      json: { key },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deleteApiKey(
  client: Client,
  provider: string
): Promise<boolean> {
  try {
    const res = await client.api.auth[":provider"].$delete({
      param: { provider },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function useModelsSettings() {
  const { api: client } = useStore();
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [initialProviderId, setInitialProviderId] = createSignal<
    string | undefined
  >();
  const [hybridEnabled, setHybridEnabled] = createSignal(true);

  const [providerList, { mutate: mutateProviders }] = createResource(
    async () => {
      const res = await client.api.models.available.$get();
      if (!res.ok) {
        return EMPTY_PROVIDERS;
      }
      return (await res.json()) as ProviderItem[];
    }
  );

  const catalogProviders = createMemo(() => providerList() ?? EMPTY_PROVIDERS);

  const hasLoaded = createMemo(() => providerList() !== undefined);

  const connectedProviders = createMemo(() =>
    catalogProviders().filter((provider) => provider.connected)
  );

  const handleConnect = async (
    providerId: string,
    key: string
  ): Promise<boolean> => {
    const ok = await setApiKey(client, providerId, key);
    if (ok) {
      mutateProviders((prev) =>
        (prev ?? EMPTY_PROVIDERS).map((provider) =>
          provider.id === providerId
            ? { ...provider, connected: true }
            : provider
        )
      );
    }
    return ok;
  };

  const handleDisconnect = async (providerId: string): Promise<boolean> => {
    const ok = await deleteApiKey(client, providerId);
    if (ok) {
      mutateProviders((prev) =>
        (prev ?? EMPTY_PROVIDERS).map((provider) =>
          provider.id === providerId
            ? { ...provider, connected: false }
            : provider
        )
      );
    }
    return ok;
  };

  const openModal = (providerId?: string) => {
    setInitialProviderId(providerId);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setInitialProviderId(undefined);
  };

  return {
    catalogProviders,
    closeModal,
    connectedProviders,
    handleConnect,
    handleDisconnect,
    hasLoaded,
    hybridEnabled,
    initialProviderId,
    isModalOpen,
    openModal,
    setHybridEnabled,
  };
}
