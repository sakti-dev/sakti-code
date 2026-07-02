import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ProfileEditor } from "../profile-editor";

const mocks = vi.hoisted(() => ({
  profilesGet: vi.fn(),
  profilesPut: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    api: {
      api: {
        profiles: {
          $get: mocks.profilesGet,
          $put: mocks.profilesPut,
        },
        models: {
          available: {
            $get: vi.fn().mockResolvedValue({
              ok: true,
              json: () => Promise.resolve([]),
            }),
            ":provider": {
              $get: vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve([]),
              }),
            },
          },
          connected: {
            $get: vi.fn().mockResolvedValue({
              ok: true,
              json: () =>
                Promise.resolve([
                  {
                    providerId: "anthropic",
                    providerName: "Anthropic",
                    models: [
                      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true },
                    ],
                  },
                ]),
            }),
          },
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

const defaultProfiles = {
  defaultProfile: "default",
  profiles: {
    default: {
      name: "Default",
      models: {
        default: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      },
    },
  },
};

describe("ProfileEditor", () => {
  beforeEach(() => {
    mocks.profilesGet.mockReset();
    mocks.profilesPut.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders profile cards on load", async () => {
    mocks.profilesGet.mockImplementation(() => okRes(defaultProfiles));
    render(() => <ProfileEditor />);
    expect(await screen.findByDisplayValue("Default")).toBeTruthy();
  });

  it("shows 'Add profile' button", async () => {
    mocks.profilesGet.mockImplementation(() => okRes(defaultProfiles));
    render(() => <ProfileEditor />);
    expect(await screen.findByText("Add profile")).toBeTruthy();
  });

  it("shows mode labels", async () => {
    mocks.profilesGet.mockImplementation(() => okRes(defaultProfiles));
    render(() => <ProfileEditor />);
    await screen.findByDisplayValue("Default");
    expect(screen.getByText("Intake")).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("Build")).toBeTruthy();
  });

  it("shows observational memory mode labels", async () => {
    mocks.profilesGet.mockImplementation(() => okRes(defaultProfiles));
    render(() => <ProfileEditor />);
    await screen.findByDisplayValue("Default");
    expect(screen.getByText("Observe")).toBeTruthy();
    expect(screen.getByText("Reflect")).toBeTruthy();
  });

  it("shows 'Uses Default' placeholder for unset non-default modes", async () => {
    mocks.profilesGet.mockImplementation(() => okRes(defaultProfiles));
    render(() => <ProfileEditor />);
    await screen.findByDisplayValue("Default");
    const placeholders = await screen.findAllByText("Uses Default");
    expect(placeholders.length).toBe(5);
  });

  it("shows Observational Memory section label", async () => {
    mocks.profilesGet.mockImplementation(() => okRes(defaultProfiles));
    render(() => <ProfileEditor />);
    await screen.findByDisplayValue("Default");
    expect(screen.getByText("Observational Memory")).toBeTruthy();
  });

  it("saves via PUT when profile name is edited", async () => {
    mocks.profilesGet.mockImplementation(() => okRes(defaultProfiles));
    mocks.profilesPut.mockImplementation(() => okPut());
    render(() => <ProfileEditor />);
    const nameInput = (await screen.findByDisplayValue("Default")) as HTMLInputElement;
    nameInput.value = "My Default";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => {
      expect(mocks.profilesPut).toHaveBeenCalled();
    });
  });

  it("adds a new profile when 'Add profile' is clicked", async () => {
    mocks.profilesGet.mockImplementation(() => okRes(defaultProfiles));
    mocks.profilesPut.mockImplementation(() => okPut());
    render(() => <ProfileEditor />);
    fireEvent.click(await screen.findByText("Add profile"));
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => {
      expect(mocks.profilesPut).toHaveBeenCalled();
    });
    const putCall = mocks.profilesPut.mock.calls[0];
    const body = putCall?.[0]?.json;
    expect(Object.keys((body as Record<string, unknown>)?.profiles ?? {}).length).toBe(2);
  });

  it("shows default badge on the default profile", async () => {
    mocks.profilesGet.mockImplementation(() => okRes(defaultProfiles));
    render(() => <ProfileEditor />);
    await screen.findByDisplayValue("Default");
    const badges = screen.getAllByText("Default");
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });
});
