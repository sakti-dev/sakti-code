import { render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileSelect } from "../profile-select";

const mocks = vi.hoisted(() => ({
  profilesGet: vi.fn(),
  selectProfile: vi.fn(),
}));

const sessions: Record<string, { profileId: string | null }> = {};

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    api: { api: { profiles: { $get: mocks.profilesGet } } },
    server: {
      actions: { selectProfile: mocks.selectProfile },
      store: {
        activeSessionId: null,
        sessions,
      },
    },
  }),
}));

function profilesRes(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

describe("ProfileSelect", () => {
  beforeEach(() => {
    mocks.profilesGet.mockReset();
    mocks.selectProfile.mockReset();
    for (const key of Object.keys(sessions)) {
      delete sessions[key];
    }
  });

  it("shows 'Select profile' when no session is active", async () => {
    mocks.profilesGet.mockImplementation(() =>
      profilesRes({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: { provider: "anthropic", model: "claude-sonnet" },
            },
          },
          fast: {
            name: "Fast",
            models: { default: { provider: "openai", model: "gpt-4o-mini" } },
          },
        },
      })
    );
    render(() => <ProfileSelect sessionId={null} />);
    expect(await screen.findByText("Select profile")).toBeTruthy();
  });

  it("shows active profile name when session has no profileId", async () => {
    sessions["sess-1"] = { profileId: null };
    mocks.profilesGet.mockImplementation(() =>
      profilesRes({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: { provider: "anthropic", model: "claude-sonnet" },
            },
          },
        },
      })
    );
    render(() => <ProfileSelect sessionId="sess-1" />);
    expect(await screen.findByText("Default")).toBeTruthy();
  });

  it("is disabled when no session is active", async () => {
    mocks.profilesGet.mockImplementation(() =>
      profilesRes({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: {
              default: { provider: "anthropic", model: "claude-sonnet" },
            },
          },
        },
      })
    );
    render(() => <ProfileSelect sessionId={null} />);
    const trigger = await screen.findByText("Select profile");
    expect(trigger.closest("button")?.disabled).toBe(true);
  });

  it("shows nothing when profiles have not loaded", () => {
    mocks.profilesGet.mockImplementation(() => new Promise(() => {}));
    render(() => <ProfileSelect sessionId="sess-1" />);
    expect(screen.queryByText("Select profile")).toBeNull();
  });
});
