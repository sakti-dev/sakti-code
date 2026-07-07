import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  profilesGet: vi.fn(),
  selectProfile: vi.fn(),
  getDraft: vi.fn<(projectId: string) => string | undefined>(() => undefined),
  setDraft: vi.fn(),
}));

const sessions: Record<string, { profileId: string | null }> = {};

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    api: { api: { profiles: { $get: mocks.profilesGet } } },
    server: {
      actions: { selectProfile: mocks.selectProfile },
      store: {
        activeProjectId: "p1",
        activeSessionId: null,
        sessions,
      },
    },
  }),
}));

vi.mock("~/stores/workspace/draft-profile-store", () => ({
  getDraftProfile: mocks.getDraft,
  setDraftProfile: mocks.setDraft,
}));

import { ProfileSelect } from "../profile-select";

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
    mocks.getDraft.mockReset();
    mocks.setDraft.mockReset();
    mocks.getDraft.mockImplementation(() => undefined);
    for (const key of Object.keys(sessions)) {
      delete sessions[key];
    }
  });

  it("shows the default profile name even when no session is active", async () => {
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
      }),
    );
    render(() => <ProfileSelect sessionId={null} />);
    expect(await screen.findByText("Default")).toBeTruthy();
  });

  it("shows the draft profile name when no session is active and a draft is set", async () => {
    mocks.getDraft.mockImplementation(() => "fast");
    mocks.profilesGet.mockImplementation(() =>
      profilesRes({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: { default: { provider: "anthropic", model: "claude-sonnet" } },
          },
          fast: {
            name: "Fast",
            models: { default: { provider: "openai", model: "gpt-4o-mini" } },
          },
        },
      }),
    );
    render(() => <ProfileSelect sessionId={null} />);
    expect(await screen.findByText("Fast")).toBeTruthy();
  });

  it("stashes a per-project draft when picking a profile with no session", async () => {
    mocks.profilesGet.mockImplementation(() =>
      profilesRes({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: { default: { provider: "anthropic", model: "claude-sonnet" } },
          },
          fast: {
            name: "Fast",
            models: { default: { provider: "openai", model: "gpt-4o-mini" } },
          },
        },
      }),
    );
    render(() => <ProfileSelect sessionId={null} />);
    // Wait for the trigger to render, then select "fast" via the Kobalte select.
    const trigger = (await screen.findByText("Default")).closest("button")!;
    fireEvent.pointerDown(trigger, { pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerUp(trigger, { pointerId: 1, pointerType: "mouse" });
    fireEvent.click(trigger);
    const fastOption = await screen.findByText("Fast");
    fireEvent.click(fastOption);
    expect(mocks.setDraft).toHaveBeenCalledWith("p1", "fast");
    expect(mocks.selectProfile).not.toHaveBeenCalled();
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
      }),
    );
    render(() => <ProfileSelect sessionId="sess-1" />);
    expect(await screen.findByText("Default")).toBeTruthy();
  });

  it("is enabled even when no session is active", async () => {
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
      }),
    );
    render(() => <ProfileSelect sessionId={null} />);
    const trigger = (await screen.findByText("Default")).closest("button");
    expect(trigger?.disabled).toBe(false);
  });

  it("shows nothing when profiles have not loaded", () => {
    mocks.profilesGet.mockImplementation(() => new Promise(() => {}));
    render(() => <ProfileSelect sessionId="sess-1" />);
    expect(screen.queryByText("Select profile")).toBeNull();
  });

  it("renders profile name in dropdown items, not the raw id", async () => {
    sessions["sess-1"] = { profileId: null };
    mocks.profilesGet.mockImplementation(() =>
      profilesRes({
        defaultProfile: "profile-x",
        profiles: {
          "profile-x": {
            name: "Kocak",
            models: { default: { provider: "opencode", model: "deepseek-v4-flash-free" } },
          },
        },
      }),
    );
    render(() => <ProfileSelect sessionId="sess-1" />);
    const trigger = (await screen.findByText("Kocak")).closest("button")!;
    fireEvent.pointerDown(trigger, { pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerUp(trigger, { pointerId: 1, pointerType: "mouse" });
    fireEvent.click(trigger);
    const options = await screen.findAllByRole("option");
    expect(options.some((el) => el.textContent === "Kocak")).toBe(true);
  });
});
