import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from "solid-js";

interface ProviderItem {
  connected: boolean;
  id: string;
  modelCount: number;
  name: string;
}

interface UseProviderConnectOptions {
  initialProviderId: () => string | undefined;
  isOpen: () => boolean;
  onConnect: (providerId: string, key: string) => Promise<boolean>;
  providers: () => ProviderItem[];
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function useProviderConnect(options: UseProviderConnectOptions) {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [selectedProviderId, setSelectedProviderId] = createSignal<
    string | null
  >(null);
  const [tokenByProvider, setTokenByProvider] = createSignal<
    Record<string, string>
  >({});
  const [errorByProvider, setErrorByProvider] = createSignal<
    Record<string, string>
  >({});
  let providerSearchInputRef: HTMLInputElement | undefined;

  const setProviderSearchInputRef = (element: HTMLInputElement) => {
    providerSearchInputRef = element;
  };

  // Reset transient state on close; set initial selection on the
  // closed→open transition only (untracked reads so providers changes
  // while open don't yank the user's navigated selection back).
  createEffect(
    on(options.isOpen, (isOpen) => {
      if (!isOpen) {
        setSearchQuery("");
        setTokenByProvider({});
        setErrorByProvider({});
        return;
      }
      const initialId = untrack(options.initialProviderId);
      const providers = untrack(options.providers);
      const targetId =
        initialId && providers.some((p) => p.id === initialId)
          ? initialId
          : (providers[0]?.id ?? null);
      setSelectedProviderId(targetId);
    })
  );

  const focusProviderSearchInput = () => {
    const input = providerSearchInputRef;
    if (!input) {
      return false;
    }
    input.focus({ preventScroll: true });
    const cursor = input.value.length;
    input.setSelectionRange(cursor, cursor);
    return document.activeElement === input;
  };

  createEffect(
    on(options.isOpen, (isOpen) => {
      if (!isOpen) {
        return;
      }
      const frame = requestAnimationFrame(() => {
        focusProviderSearchInput();
      });
      onCleanup(() => {
        cancelAnimationFrame(frame);
      });
    })
  );

  const filteredProviders = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    const providers = options.providers();
    if (!query) {
      return providers;
    }
    return providers.filter((provider) => {
      const haystack = `${provider.id} ${provider.name}`.toLowerCase();
      return haystack.includes(query);
    });
  });

  const visibleProviderIds = createMemo(() =>
    filteredProviders().map((p) => p.id)
  );

  const selectedProvider = createMemo(() => {
    const selectedId = selectedProviderId();
    const providers = options.providers();
    if (selectedId) {
      const matched = providers.find((p) => p.id === selectedId);
      if (matched) {
        return matched;
      }
    }
    return providers[0] ?? null;
  });

  // Derived from the single source of truth (selectedProviderId) — no
  // mirrored signal + sync effect needed.
  const activeIndex = createMemo(() => {
    const ids = visibleProviderIds();
    const selected = selectedProviderId();
    if (!selected) {
      return 0;
    }
    const idx = ids.indexOf(selected);
    return idx >= 0 ? idx : 0;
  });

  // Keep selection within the filtered list (e.g. after a search narrows
  // the results and the current selection falls out of view).
  createEffect(() => {
    if (!options.isOpen()) {
      return;
    }
    const ids = visibleProviderIds();
    if (ids.length === 0) {
      return;
    }
    const selected = selectedProviderId();
    if (!(selected && ids.includes(selected))) {
      setSelectedProviderId(ids[0] ?? null);
    }
  });

  const navigateProvider = (direction: 1 | -1) => {
    const ids = visibleProviderIds();
    if (ids.length === 0) {
      return;
    }
    const next = (activeIndex() + direction + ids.length) % ids.length;
    setSelectedProviderId(ids[next] ?? null);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const ids = visibleProviderIds();
    if (ids.length === 0) {
      return;
    }

    const isSearchInputTarget = event.target === providerSearchInputRef;
    if (isEditableElement(event.target) && !isSearchInputTarget) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      navigateProvider(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      navigateProvider(-1);
    }
  };

  const connectToken = async (providerId: string) => {
    const tokenDraft = tokenByProvider()[providerId];
    const token = typeof tokenDraft === "string" ? tokenDraft.trim() : "";
    if (token.length === 0) {
      setErrorByProvider((prev) => ({
        ...prev,
        [providerId]: "API key is required.",
      }));
      return;
    }

    const ok = await options.onConnect(providerId, token);
    if (ok) {
      setTokenByProvider((prev) => ({ ...prev, [providerId]: "" }));
      setErrorByProvider((prev) => ({ ...prev, [providerId]: "" }));
    } else {
      setErrorByProvider((prev) => ({
        ...prev,
        [providerId]: "Failed to save API key.",
      }));
    }
  };

  const setTokenDraft = (providerId: string, token: string) => {
    setTokenByProvider((prev) => ({ ...prev, [providerId]: token }));
  };

  return {
    connectToken,
    errorByProvider,
    filteredProviders,
    handleKeyDown,
    searchQuery,
    selectedProvider,
    selectedProviderId,
    setProviderSearchInputRef,
    setSearchQuery,
    setSelectedProviderId,
    setTokenDraft,
    tokenByProvider,
  };
}
