import type {
  ProviderAuthMethodDescriptor,
  ProviderAuthState,
  ProviderClient,
  ProviderDescriptor,
  ProviderModel,
} from "@/core/services/api/provider-client";
import { For, Show, createSignal, onMount } from "solid-js";
import { ModelSelector } from "./model-selector";

interface ProviderSettingsProps {
  client: ProviderClient;
}

export function ProviderSettings(props: ProviderSettingsProps) {
  const [providers, setProviders] = createSignal<ProviderDescriptor[]>([]);
  const [authMethods, setAuthMethods] = createSignal<
    Record<string, ProviderAuthMethodDescriptor[]>
  >({});
  const [auth, setAuth] = createSignal<Record<string, ProviderAuthState>>({});
  const [models, setModels] = createSignal<ProviderModel[]>([]);
  const [tokenByProvider, setTokenByProvider] = createSignal<Record<string, string>>({});
  const [oauthCodeByProvider, setOauthCodeByProvider] = createSignal<Record<string, string>>({});
  const [oauthPendingByProvider, setOauthPendingByProvider] = createSignal<
    Record<string, { methodIndex: number; authorizationId: string }>
  >({});
  const [oauthBusyByProvider, setOauthBusyByProvider] = createSignal<Record<string, boolean>>({});
  const [oauthErrorByProvider, setOauthErrorByProvider] = createSignal<Record<string, string>>({});
  const [oauthRunByProvider, setOauthRunByProvider] = createSignal<Record<string, string>>({});
  const [selectedModel, setSelectedModel] = createSignal<string>("");
  const [isLoading, setIsLoading] = createSignal(true);

  const refreshData = async () => {
    setIsLoading(true);
    try {
      const [providerData, methodData, authData, modelData] = await Promise.all([
        props.client.listProviders(),
        props.client.listAuthMethods(),
        props.client.listAuthStates(),
        props.client.listModels(),
      ]);
      setProviders(providerData);
      setAuthMethods(methodData);
      setAuth(authData);
      setModels(modelData);
      if (!selectedModel() && modelData.length > 0) {
        const storedModel = localStorage.getItem("ekacode:selected-model");
        if (storedModel && modelData.some(model => model.id === storedModel)) {
          setSelectedModel(storedModel);
        } else {
          setSelectedModel(modelData[0]!.id);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  onMount(() => {
    void refreshData();
  });

  const setTokenDraft = (providerId: string, token: string) => {
    setTokenByProvider(prev => ({ ...prev, [providerId]: token }));
  };

  const connectToken = async (providerId: string) => {
    const token = tokenByProvider()[providerId]?.trim();
    if (!token) return;

    await props.client.setToken(providerId, token);
    setTokenDraft(providerId, "");
    await refreshData();
  };

  const disconnect = async (providerId: string) => {
    await props.client.clearToken(providerId);
    await refreshData();
  };

  const setOauthCodeDraft = (providerId: string, code: string) => {
    setOauthCodeByProvider(prev => ({ ...prev, [providerId]: code }));
  };

  const openExternal = async (url: string) => {
    if (window.ekacodeAPI?.shell?.openExternal) {
      await window.ekacodeAPI.shell.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const connectOAuth = async (providerId: string, methodIndex: number) => {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setOauthRunByProvider(prev => ({ ...prev, [providerId]: runId }));
    setOauthBusyByProvider(prev => ({ ...prev, [providerId]: true }));
    setOauthErrorByProvider(prev => ({ ...prev, [providerId]: "" }));

    try {
      const authorization = await props.client.oauthAuthorize(providerId, methodIndex);
      await openExternal(authorization.url);

      if (authorization.method === "auto") {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (oauthRunByProvider()[providerId] !== runId) {
            setOauthBusyByProvider(prev => ({ ...prev, [providerId]: false }));
            return;
          }
          const callback = await props.client.oauthCallback(
            providerId,
            methodIndex,
            authorization.authorizationId
          );
          if (callback.status === "connected") {
            setOauthBusyByProvider(prev => ({ ...prev, [providerId]: false }));
            await refreshData();
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 750));
        }
        setOauthErrorByProvider(prev => ({
          ...prev,
          [providerId]: "Authorization is still pending. Retry or continue waiting.",
        }));
        return;
      }

      setOauthPendingByProvider(prev => ({
        ...prev,
        [providerId]: { methodIndex, authorizationId: authorization.authorizationId },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOauthErrorByProvider(prev => ({ ...prev, [providerId]: message }));
    } finally {
      setOauthBusyByProvider(prev => ({ ...prev, [providerId]: false }));
    }
  };

  const submitOAuthCode = async (providerId: string) => {
    const pending = oauthPendingByProvider()[providerId];
    const code = oauthCodeByProvider()[providerId]?.trim();
    if (!pending || !code) return;

    const callback = await props.client.oauthCallback(
      providerId,
      pending.methodIndex,
      pending.authorizationId,
      code
    );

    if (callback.status === "connected") {
      setOauthPendingByProvider(prev => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
      setOauthCodeByProvider(prev => ({ ...prev, [providerId]: "" }));
      await refreshData();
    }
  };

  const cancelOAuth = (providerId: string) => {
    setOauthRunByProvider(prev => ({ ...prev, [providerId]: `${Date.now()}-cancelled` }));
    setOauthBusyByProvider(prev => ({ ...prev, [providerId]: false }));
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    localStorage.setItem("ekacode:selected-model", modelId);
    const model = models().find(entry => entry.id === modelId);
    if (model?.providerId) {
      localStorage.setItem("ekacode:selected-provider", model.providerId);
    }
  };

  return (
    <section class="mb-8">
      <h2 class="text-foreground mb-4 text-lg font-medium">Providers</h2>
      <div class="bg-card border-border rounded-lg border p-4">
        <Show when={!isLoading()} fallback={<p class="text-sm">Loading providers...</p>}>
          <div class="space-y-4">
            <For each={providers()}>
              {provider => {
                const state = () => auth()[provider.id];
                const connected = () => state()?.status === "connected";
                const methods = () => authMethods()[provider.id] || [];
                const tokenMethod = () => methods().find(method => method.type === "token");
                const oauthMethodIndex = () =>
                  methods().findIndex(method => method.type === "oauth");
                const oauthMethod = () =>
                  oauthMethodIndex() >= 0 ? methods()[oauthMethodIndex()] : undefined;
                const oauthPending = () => oauthPendingByProvider()[provider.id];
                const oauthBusy = () => oauthBusyByProvider()[provider.id] === true;
                const oauthError = () => oauthErrorByProvider()[provider.id];

                return (
                  <div
                    class="border-border rounded border p-3"
                    data-testid={`provider-${provider.id}`}
                  >
                    <div class="mb-2 flex items-center justify-between">
                      <div>
                        <p class="text-sm font-medium">{provider.name}</p>
                        <p class="text-muted-foreground text-xs">{provider.id}</p>
                      </div>
                      <span class="text-xs" data-testid={`provider-status-${provider.id}`}>
                        {connected() ? "Connected" : "Disconnected"}
                      </span>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                      <Show when={tokenMethod()}>
                        <input
                          type="password"
                          class="bg-background border-border rounded border px-2 py-1 text-xs"
                          placeholder="API token"
                          value={tokenByProvider()[provider.id] || ""}
                          onInput={event => setTokenDraft(provider.id, event.currentTarget.value)}
                        />
                        <button
                          class="bg-primary text-primary-foreground rounded px-2 py-1 text-xs"
                          onClick={() => connectToken(provider.id)}
                        >
                          Connect
                        </button>
                      </Show>
                      <Show when={oauthMethod()}>
                        <button
                          class="border-border rounded border px-2 py-1 text-xs"
                          disabled={oauthBusy()}
                          onClick={() => connectOAuth(provider.id, oauthMethodIndex())}
                        >
                          {oauthMethod()?.label}
                        </button>
                      </Show>
                      <Show when={oauthBusy()}>
                        <button
                          class="border-border rounded border px-2 py-1 text-xs"
                          onClick={() => cancelOAuth(provider.id)}
                        >
                          Cancel OAuth
                        </button>
                      </Show>
                      <button
                        class="border-border rounded border px-2 py-1 text-xs"
                        onClick={() => disconnect(provider.id)}
                      >
                        Disconnect
                      </button>
                    </div>
                    <Show when={oauthPending()}>
                      <div class="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          class="bg-background border-border rounded border px-2 py-1 text-xs"
                          placeholder="Paste OAuth code"
                          value={oauthCodeByProvider()[provider.id] || ""}
                          onInput={event =>
                            setOauthCodeDraft(provider.id, event.currentTarget.value)
                          }
                        />
                        <button
                          class="bg-primary text-primary-foreground rounded px-2 py-1 text-xs"
                          onClick={() => submitOAuthCode(provider.id)}
                        >
                          Submit Code
                        </button>
                      </div>
                    </Show>
                    <Show when={oauthError()}>
                      <p class="mt-2 text-xs text-red-600 dark:text-red-400">{oauthError()}</p>
                    </Show>
                  </div>
                );
              }}
            </For>

            <Show when={models().length > 0}>
              <ModelSelector
                models={models()}
                selectedModelId={selectedModel()}
                onChange={handleModelChange}
              />
            </Show>
          </div>
        </Show>
      </div>
    </section>
  );
}
