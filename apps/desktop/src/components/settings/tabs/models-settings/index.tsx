import { createMemo, createResource, createSignal } from "solid-js";
import "./models-settings.css";
import type { Client } from "~/lib/api";
import { useStore } from "~/stores/store-context";
import { ProfileEditor } from "../profile-editor";
import { ConnectedProvidersList } from "./connected-providers-list";
import { HybridVisionCard } from "./hybrid-vision-card";
import { ProviderConnectModal } from "./provider-connect-modal";

interface ApiKeyInfo {
  hasKey: boolean;
  maskedKey: string | null;
  provider: string;
}

interface ProviderItem {
  connected: boolean;
  id: string;
  modelCount: number;
  name: string;
}

async function fetchApiKeys(client: Client): Promise<ApiKeyInfo[]> {
  try {
    const res = await client.api.auth.$get();
    if (!res.ok) {
      return [];
    }
    return (await res.json()) as ApiKeyInfo[];
  } catch {
    return [];
  }
}

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

export function ModelsSettings() {
  const { api: client } = useStore();
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [initialProviderId, setInitialProviderId] = createSignal<
    string | undefined
  >();
  const [hybridEnabled, setHybridEnabled] = createSignal(true);

  const [providerList] = createResource(async () => {
    const res = await client.api.models.available.$get();
    if (!res.ok) {
      return [] as Omit<ProviderItem, "connected">[];
    }
    return (await res.json()) as Omit<ProviderItem, "connected">[];
  });

  const [apiKeyInfos, { refetch: refetchApiKeys, mutate: mutateApiKeys }] =
    createResource(() => fetchApiKeys(client));

  const connectedSet = createMemo(() => {
    const infos = apiKeyInfos();
    if (!infos) {
      return new Set<string>();
    }
    return new Set(
      infos.filter((info) => info.hasKey).map((info) => info.provider)
    );
  });

  const catalogProviders = createMemo<ProviderItem[]>(() => {
    const providers = providerList();
    if (!providers) {
      return [];
    }
    const connected = connectedSet();
    return providers.map((p) => ({
      ...p,
      connected: connected.has(p.id),
    }));
  });

  const hasLoaded = createMemo(
    () => apiKeyInfos() !== undefined && providerList() !== undefined
  );

  const connectedProviders = createMemo(() =>
    catalogProviders().filter((provider) => provider.connected)
  );

  const handleConnect = async (
    providerId: string,
    key: string
  ): Promise<boolean> => {
    const ok = await setApiKey(client, providerId, key);
    if (ok) {
      mutateApiKeys((prev) =>
        (prev ?? []).map((info) =>
          info.provider === providerId
            ? {
                ...info,
                hasKey: true,
                maskedKey: `...${key.slice(-4)}`,
              }
            : info
        )
      );
      await refetchApiKeys();
    }
    return ok;
  };

  const handleDisconnect = async (providerId: string): Promise<boolean> => {
    const ok = await deleteApiKey(client, providerId);
    if (ok) {
      mutateApiKeys((prev) =>
        (prev ?? []).map((info) =>
          info.provider === providerId
            ? { ...info, hasKey: false, maskedKey: null }
            : info
        )
      );
      await refetchApiKeys();
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

  return (
    <>
      <ConnectedProvidersList
        hasLoaded={hasLoaded()}
        onDisconnect={handleDisconnect}
        onOpenModal={openModal}
        providers={connectedProviders()}
      />

      <ProfileEditor />

      <HybridVisionCard enabled={hybridEnabled()} onToggle={setHybridEnabled} />

      <ProviderConnectModal
        initialProviderId={initialProviderId()}
        isOpen={isModalOpen()}
        onClose={closeModal}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        providers={catalogProviders()}
      />
    </>
  );
}
