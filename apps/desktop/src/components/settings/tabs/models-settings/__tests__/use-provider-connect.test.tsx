import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { useProviderConnect } from "../use-provider-connect";

interface ProviderItem {
  connected: boolean;
  id: string;
  modelCount: number;
  name: string;
}

function sampleProviders(): ProviderItem[] {
  return [
    { id: "anthropic", name: "Anthropic", modelCount: 5, connected: false },
    { id: "openai", name: "OpenAI", modelCount: 10, connected: true },
    { id: "google", name: "Google", modelCount: 3, connected: false },
  ];
}

function setupHook(options?: {
  initialProviderId?: string | undefined;
  isOpen?: boolean;
  onConnect?: (id: string, key: string) => Promise<boolean>;
  providers?: ProviderItem[];
}) {
  return createRoot((dispose) => {
    const [isOpen, setIsOpen] = createSignal(options?.isOpen ?? true);
    const [providers, setProviders] = createSignal(
      options?.providers ?? sampleProviders()
    );
    const [initialProviderId] = createSignal(options?.initialProviderId);
    const onConnect = options?.onConnect ?? vi.fn().mockResolvedValue(true);

    const result = useProviderConnect({
      initialProviderId,
      isOpen,
      onConnect,
      providers,
    });

    return {
      ...result,
      dispose,
      setIsOpen,
      setProviders,
    };
  });
}

describe("useProviderConnect", () => {
  describe("filteredProviders", () => {
    it("returns all providers when search is empty", () => {
      const { filteredProviders, dispose } = setupHook();
      expect(filteredProviders()).toHaveLength(3);
      dispose();
    });

    it("filters by provider id", () => {
      const { filteredProviders, setSearchQuery, dispose } = setupHook();
      setSearchQuery("openai");
      expect(filteredProviders()).toHaveLength(1);
      expect(filteredProviders()[0]!.id).toBe("openai");
      dispose();
    });

    it("filters by provider name (case-insensitive)", () => {
      const { filteredProviders, setSearchQuery, dispose } = setupHook();
      setSearchQuery("GOOGLE");
      expect(filteredProviders()).toHaveLength(1);
      expect(filteredProviders()[0]!.id).toBe("google");
      dispose();
    });

    it("returns empty when no match", () => {
      const { filteredProviders, setSearchQuery, dispose } = setupHook();
      setSearchQuery("xyz");
      expect(filteredProviders()).toHaveLength(0);
      dispose();
    });
  });

  describe("selectedProvider", () => {
    it("falls back to first provider when no selection", () => {
      const { selectedProvider, dispose } = setupHook();
      expect(selectedProvider()?.id).toBe("anthropic");
      dispose();
    });

    it("returns the selected provider", () => {
      const { selectedProvider, setSelectedProviderId, dispose } = setupHook();
      setSelectedProviderId("openai");
      expect(selectedProvider()?.id).toBe("openai");
      dispose();
    });

    it("falls back to first when selected id is stale", () => {
      const { selectedProvider, setSelectedProviderId, setProviders, dispose } =
        setupHook();
      setSelectedProviderId("openai");
      setProviders([sampleProviders()[0]!]);
      expect(selectedProvider()?.id).toBe("anthropic");
      dispose();
    });
  });

  describe("activeIndex", () => {
    it("reflects selectedProviderId position via navigation", () => {
      const {
        setSelectedProviderId,
        handleKeyDown,
        selectedProviderId,
        dispose,
      } = setupHook();
      setSelectedProviderId("google");
      handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
      );
      expect(selectedProviderId()).toBe("openai");
      dispose();
    });
  });

  describe("handleKeyDown navigation", () => {
    it("ArrowDown advances selection", () => {
      const { handleKeyDown, selectedProviderId, dispose } = setupHook();
      selectedProviderId(); // read initial
      handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
      expect(selectedProviderId()).toBe("openai");
      dispose();
    });

    it("ArrowUp wraps around", () => {
      const { handleKeyDown, selectedProviderId, dispose } = setupHook();
      // at index 0 → ArrowUp wraps to last
      handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
      );
      expect(selectedProviderId()).toBe("google");
      dispose();
    });

    it("ArrowDown wraps around from last", () => {
      const {
        setSelectedProviderId,
        handleKeyDown,
        selectedProviderId,
        dispose,
      } = setupHook();
      setSelectedProviderId("google"); // last index
      handleKeyDown(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
      expect(selectedProviderId()).toBe("anthropic"); // wraps to first
      dispose();
    });

    it("ignores keys from editable elements that are not the search input", () => {
      const { handleKeyDown, selectedProviderId, dispose } = setupHook();
      const textarea = document.createElement("textarea");
      document.body.appendChild(textarea);
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
      });
      Object.defineProperty(event, "target", { value: textarea });
      handleKeyDown(event);
      expect(selectedProviderId()).not.toBe("openai");
      document.body.removeChild(textarea);
      dispose();
    });
  });

  describe("connectToken", () => {
    it("sets error when token is empty", async () => {
      const { connectToken, errorByProvider, dispose } = setupHook();
      await connectToken("anthropic");
      expect(errorByProvider().anthropic).toBe("API key is required.");
      dispose();
    });

    it("sets error when token is whitespace", async () => {
      const { connectToken, errorByProvider, setTokenDraft, dispose } =
        setupHook();
      setTokenDraft("anthropic", "   ");
      await connectToken("anthropic");
      expect(errorByProvider().anthropic).toBe("API key is required.");
      dispose();
    });

    it("calls onConnect and clears token on success", async () => {
      const onConnect = vi.fn().mockResolvedValue(true);
      const {
        connectToken,
        setTokenDraft,
        tokenByProvider,
        errorByProvider,
        dispose,
      } = setupHook({ onConnect });
      setTokenDraft("openai", "sk-test-key");
      await connectToken("openai");
      expect(onConnect).toHaveBeenCalledWith("openai", "sk-test-key");
      expect(tokenByProvider().openai).toBe("");
      expect(errorByProvider().openai ?? "").toBe("");
      dispose();
    });

    it("sets error when onConnect fails", async () => {
      const onConnect = vi.fn().mockResolvedValue(false);
      const { connectToken, setTokenDraft, errorByProvider, dispose } =
        setupHook({ onConnect });
      setTokenDraft("anthropic", "sk-bad-key");
      await connectToken("anthropic");
      expect(errorByProvider().anthropic).toBe("Failed to save API key.");
      dispose();
    });
  });

  describe("setTokenDraft", () => {
    it("stores the token draft per provider", () => {
      const { setTokenDraft, tokenByProvider, dispose } = setupHook();
      setTokenDraft("anthropic", "sk-abc");
      setTokenDraft("openai", "sk-def");
      expect(tokenByProvider().anthropic).toBe("sk-abc");
      expect(tokenByProvider().openai).toBe("sk-def");
      dispose();
    });
  });

  describe("open transition", () => {
    it("sets initial selection from initialProviderId on open", async () => {
      const { selectedProviderId, setIsOpen, dispose } = setupHook({
        initialProviderId: "google",
        isOpen: false,
      });
      setIsOpen(true);
      await vi.waitFor(() => {
        expect(selectedProviderId()).toBe("google");
      });
      dispose();
    });

    it("falls back to first provider when initialProviderId is invalid", async () => {
      const { selectedProviderId, setIsOpen, dispose } = setupHook({
        initialProviderId: "nonexistent",
        isOpen: false,
      });
      setIsOpen(true);
      await vi.waitFor(() => {
        expect(selectedProviderId()).toBe("anthropic");
      });
      dispose();
    });

    it("does not reset selection when providers change while open", async () => {
      const {
        selectedProviderId,
        setSelectedProviderId,
        setProviders,
        dispose,
      } = setupHook({ isOpen: true });
      await vi.waitFor(() => {
        expect(selectedProviderId()).toBeTruthy();
      });
      setSelectedProviderId("google");
      // Simulate a providers array swap (e.g. after connect mutate)
      setProviders(sampleProviders().map((p) => ({ ...p, id: p.id })));
      expect(selectedProviderId()).toBe("google");
      dispose();
    });

    it("resets transient state on close", async () => {
      const {
        setSearchQuery,
        searchQuery,
        setTokenDraft,
        tokenByProvider,
        setIsOpen,
        dispose,
      } = setupHook({ isOpen: true });
      setSearchQuery("openai");
      setTokenDraft("anthropic", "sk-test");
      expect(searchQuery()).toBe("openai");
      expect(tokenByProvider().anthropic).toBe("sk-test");
      setIsOpen(false);
      await vi.waitFor(() => {
        expect(searchQuery()).toBe("");
      });
      expect(tokenByProvider().anthropic).toBeUndefined();
      dispose();
    });
  });
});
