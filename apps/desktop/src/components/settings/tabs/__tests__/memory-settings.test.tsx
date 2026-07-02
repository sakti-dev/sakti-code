import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemorySettings } from "../memory-settings";

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsPut: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    api: {
      api: {
        settings: {
          $get: mocks.settingsGet,
          $put: mocks.settingsPut,
        },
      },
    },
  }),
}));

function okRes(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
}

function okPut() {
  return Promise.resolve({ ok: true });
}

describe("MemorySettings", () => {
  beforeEach(() => {
    mocks.settingsGet.mockReset();
    mocks.settingsPut.mockReset();
  });

  it("renders Observational Memory heading", async () => {
    mocks.settingsGet.mockImplementation(() => okRes({}));
    render(() => <MemorySettings />);
    expect(await screen.findByText("Observational Memory")).toBeTruthy();
  });

  it("shows checked toggle when OM is absent from settings (default enabled)", async () => {
    mocks.settingsGet.mockImplementation(() => okRes({}));
    render(() => <MemorySettings />);
    const checkbox = (await screen.findByTestId("om-enabled-toggle")) as HTMLInputElement;
    await vi.waitFor(() => expect(checkbox.checked).toBe(true));
  });

  it("shows checked toggle when OM is enabled in settings", async () => {
    mocks.settingsGet.mockImplementation(() => okRes({ observationalMemory: { enabled: true } }));
    render(() => <MemorySettings />);
    const checkbox = (await screen.findByTestId("om-enabled-toggle")) as HTMLInputElement;
    await vi.waitFor(() => expect(checkbox.checked).toBe(true));
  });

  it("shows unchecked toggle when OM is explicitly disabled in settings", async () => {
    mocks.settingsGet.mockImplementation(() => okRes({ observationalMemory: { enabled: false } }));
    render(() => <MemorySettings />);
    const checkbox = (await screen.findByTestId("om-enabled-toggle")) as HTMLInputElement;
    await vi.waitFor(() => expect(checkbox.checked).toBe(false));
  });

  it("PUTs { observationalMemory: { enabled: true } } when toggled on", async () => {
    mocks.settingsGet.mockImplementation(() => okRes({ observationalMemory: { enabled: false } }));
    mocks.settingsPut.mockImplementation(() => okPut());
    render(() => <MemorySettings />);
    const checkbox = (await screen.findByTestId("om-enabled-toggle")) as HTMLInputElement;
    await vi.waitFor(() => expect(checkbox.checked).toBe(false));
    fireEvent.click(checkbox);
    await vi.waitFor(() => {
      expect(mocks.settingsPut).toHaveBeenCalledWith({
        json: { observationalMemory: { enabled: true } },
      });
    });
  });

  it("PUTs { observationalMemory: { enabled: false } } when toggled off from default", async () => {
    mocks.settingsGet.mockImplementation(() => okRes({}));
    mocks.settingsPut.mockImplementation(() => okPut());
    render(() => <MemorySettings />);
    const checkbox = (await screen.findByTestId("om-enabled-toggle")) as HTMLInputElement;
    await vi.waitFor(() => expect(checkbox.checked).toBe(true));
    fireEvent.click(checkbox);
    await vi.waitFor(() => {
      expect(mocks.settingsPut).toHaveBeenCalledWith({
        json: { observationalMemory: { enabled: false } },
      });
    });
  });

  it("shows hint to configure OM models in Models tab", async () => {
    mocks.settingsGet.mockImplementation(() => okRes({}));
    render(() => <MemorySettings />);
    expect(await screen.findByText(/Configure observer/i)).toBeTruthy();
  });

  it("shows observation threshold input with default 30000 when absent", async () => {
    mocks.settingsGet.mockImplementation(() => okRes({}));
    render(() => <MemorySettings />);
    const input = (await screen.findByTestId("om-observation-threshold")) as HTMLInputElement;
    await vi.waitFor(() => expect(input.value).toBe("30000"));
  });

  it("shows reflection threshold input with default 40000 when absent", async () => {
    mocks.settingsGet.mockImplementation(() => okRes({}));
    render(() => <MemorySettings />);
    const input = (await screen.findByTestId("om-reflection-threshold")) as HTMLInputElement;
    await vi.waitFor(() => expect(input.value).toBe("40000"));
  });

  it("shows custom thresholds from settings", async () => {
    mocks.settingsGet.mockImplementation(() =>
      okRes({
        observationalMemory: {
          enabled: true,
          observationThreshold: 50000,
          reflectionThreshold: 60000,
        },
      }),
    );
    render(() => <MemorySettings />);
    const obs = (await screen.findByTestId("om-observation-threshold")) as HTMLInputElement;
    const ref = (await screen.findByTestId("om-reflection-threshold")) as HTMLInputElement;
    await vi.waitFor(() => expect(obs.value).toBe("50000"));
    await vi.waitFor(() => expect(ref.value).toBe("60000"));
  });

  it("PUTs observation threshold on change", async () => {
    mocks.settingsGet.mockImplementation(() => okRes({}));
    mocks.settingsPut.mockImplementation(() => okPut());
    render(() => <MemorySettings />);
    const input = (await screen.findByTestId("om-observation-threshold")) as HTMLInputElement;
    await vi.waitFor(() => expect(input.value).toBe("30000"));
    fireEvent.input(input, { target: { value: "45000" } });
    await vi.waitFor(() => {
      expect(mocks.settingsPut).toHaveBeenCalledWith({
        json: { observationalMemory: { observationThreshold: 45000 } },
      });
    });
  });

  it("PUTs reflection threshold on change", async () => {
    mocks.settingsGet.mockImplementation(() => okRes({}));
    mocks.settingsPut.mockImplementation(() => okPut());
    render(() => <MemorySettings />);
    const input = (await screen.findByTestId("om-reflection-threshold")) as HTMLInputElement;
    await vi.waitFor(() => expect(input.value).toBe("40000"));
    fireEvent.input(input, { target: { value: "55000" } });
    await vi.waitFor(() => {
      expect(mocks.settingsPut).toHaveBeenCalledWith({
        json: { observationalMemory: { reflectionThreshold: 55000 } },
      });
    });
  });
});
