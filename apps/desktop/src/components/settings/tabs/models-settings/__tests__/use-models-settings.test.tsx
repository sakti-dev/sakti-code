import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useModelsSettings } from "../use-models-settings";

interface ProviderItem {
  connected: boolean;
  id: string;
  modelCount: number;
  name: string;
}

const mocks = vi.hoisted(() => ({
  availableGet: vi.fn(),
  postProvider: vi.fn(),
  deleteProvider: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    api: {
      api: {
        auth: {
          ":provider": {
            $post: mocks.postProvider,
            $delete: mocks.deleteProvider,
          },
        },
        models: {
          available: {
            $get: mocks.availableGet,
          },
        },
      },
    },
  }),
}));

function okRes(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function providers(connected: string[] = []): ProviderItem[] {
  return [
    {
      id: "anthropic",
      name: "Anthropic",
      modelCount: 5,
      connected: connected.includes("anthropic"),
    },
    {
      id: "openai",
      name: "OpenAI",
      modelCount: 10,
      connected: connected.includes("openai"),
    },
  ];
}

function setupHook() {
  return createRoot((dispose) => {
    const result = useModelsSettings();
    return { ...result, dispose };
  });
}

describe("useModelsSettings", () => {
  beforeEach(() => {
    mocks.availableGet.mockReset();
    mocks.postProvider.mockReset();
    mocks.deleteProvider.mockReset();
  });

  describe("catalogProviders", () => {
    it("returns providers from the resource", async () => {
      mocks.availableGet.mockImplementation(() => okRes(providers()));
      const { catalogProviders, dispose } = setupHook();
      await vi.waitFor(() => {
        expect(catalogProviders()).toHaveLength(2);
      });
      expect(catalogProviders()[0]!.id).toBe("anthropic");
      dispose();
    });

    it("returns empty on fetch failure", async () => {
      mocks.availableGet.mockResolvedValue({ ok: false });
      const { catalogProviders, dispose } = setupHook();
      await vi.waitFor(() => {
        expect(catalogProviders()).toHaveLength(0);
      });
      dispose();
    });
  });

  describe("connectedProviders", () => {
    it("filters to connected providers only", async () => {
      mocks.availableGet.mockImplementation(() => okRes(providers(["openai"])));
      const { connectedProviders, dispose } = setupHook();
      await vi.waitFor(() => {
        expect(connectedProviders()).toHaveLength(1);
      });
      expect(connectedProviders()[0]!.id).toBe("openai");
      dispose();
    });

    it("returns empty when none connected", async () => {
      mocks.availableGet.mockImplementation(() => okRes(providers()));
      const { connectedProviders, dispose } = setupHook();
      await vi.waitFor(() => {
        expect(connectedProviders()).toHaveLength(0);
      });
      dispose();
    });
  });

  describe("hasLoaded", () => {
    it("is false before resource resolves", () => {
      mocks.availableGet.mockImplementation(
        () => new Promise(() => {}), // never resolves
      );
      const { hasLoaded, dispose } = setupHook();
      expect(hasLoaded()).toBe(false);
      dispose();
    });

    it("is true after resource resolves", async () => {
      mocks.availableGet.mockImplementation(() => okRes(providers()));
      const { hasLoaded, dispose } = setupHook();
      await vi.waitFor(() => {
        expect(hasLoaded()).toBe(true);
      });
      dispose();
    });
  });

  describe("handleConnect", () => {
    it("calls POST and mutates connected to true", async () => {
      mocks.availableGet.mockImplementation(() => okRes(providers()));
      mocks.postProvider.mockImplementation(() => okRes(null));
      const { handleConnect, catalogProviders, dispose } = setupHook();
      await vi.waitFor(() => {
        expect(catalogProviders()).toHaveLength(2);
      });
      const ok = await handleConnect("anthropic", "sk-test");
      expect(ok).toBe(true);
      expect(mocks.postProvider).toHaveBeenCalledWith({
        param: { provider: "anthropic" },
        json: { key: "sk-test" },
      });
      const anthropic = catalogProviders().find((p) => p.id === "anthropic");
      expect(anthropic?.connected).toBe(true);
      dispose();
    });

    it("returns false without mutating when POST fails", async () => {
      mocks.availableGet.mockImplementation(() => okRes(providers()));
      mocks.postProvider.mockResolvedValue({ ok: false });
      const { handleConnect, catalogProviders, dispose } = setupHook();
      await vi.waitFor(() => {
        expect(catalogProviders()).toHaveLength(2);
      });
      const ok = await handleConnect("anthropic", "sk-test");
      expect(ok).toBe(false);
      const anthropic = catalogProviders().find((p) => p.id === "anthropic");
      expect(anthropic?.connected).toBe(false);
      dispose();
    });
  });

  describe("handleDisconnect", () => {
    it("calls DELETE and mutates connected to false", async () => {
      mocks.availableGet.mockImplementation(() => okRes(providers(["openai"])));
      mocks.deleteProvider.mockImplementation(() => okRes(null));
      const { handleDisconnect, catalogProviders, dispose } = setupHook();
      await vi.waitFor(() => {
        expect(catalogProviders()).toHaveLength(2);
      });
      const ok = await handleDisconnect("openai");
      expect(ok).toBe(true);
      expect(mocks.deleteProvider).toHaveBeenCalledWith({
        param: { provider: "openai" },
      });
      const openai = catalogProviders().find((p) => p.id === "openai");
      expect(openai?.connected).toBe(false);
      dispose();
    });
  });

  describe("modal state", () => {
    it("openModal sets isModalOpen and initialProviderId", () => {
      mocks.availableGet.mockImplementation(() => okRes(providers()));
      const { openModal, isModalOpen, initialProviderId, dispose } = setupHook();
      expect(isModalOpen()).toBe(false);
      openModal("anthropic");
      expect(isModalOpen()).toBe(true);
      expect(initialProviderId()).toBe("anthropic");
      dispose();
    });

    it("openModal without arg sets undefined initialProviderId", () => {
      mocks.availableGet.mockImplementation(() => okRes(providers()));
      const { openModal, initialProviderId, dispose } = setupHook();
      openModal();
      expect(initialProviderId()).toBeUndefined();
      dispose();
    });

    it("closeModal resets isModalOpen and initialProviderId", () => {
      mocks.availableGet.mockImplementation(() => okRes(providers()));
      const { openModal, closeModal, isModalOpen, initialProviderId, dispose } = setupHook();
      openModal("anthropic");
      closeModal();
      expect(isModalOpen()).toBe(false);
      expect(initialProviderId()).toBeUndefined();
      dispose();
    });
  });

  describe("hybridEnabled", () => {
    it("defaults to true", () => {
      mocks.availableGet.mockImplementation(() => okRes(providers()));
      const { hybridEnabled, dispose } = setupHook();
      expect(hybridEnabled()).toBe(true);
      dispose();
    });

    it("setHybridEnabled toggles value", () => {
      mocks.availableGet.mockImplementation(() => okRes(providers()));
      const { setHybridEnabled, hybridEnabled, dispose } = setupHook();
      setHybridEnabled(false);
      expect(hybridEnabled()).toBe(false);
      setHybridEnabled(true);
      expect(hybridEnabled()).toBe(true);
      dispose();
    });
  });
});
