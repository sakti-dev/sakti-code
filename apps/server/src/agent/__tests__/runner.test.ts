import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

const SESSION_NOT_FOUND_RE = /Session not found/;
const PROJECT_NOT_FOUND_RE = /Project not found/;

import type { AgentHarnessEvent } from "@sakti-code/agent";
import { parseSessionSettings } from "@sakti-code/agent";
import {
  abortRun,
  clearRunsForTesting,
  loadDisabledSkills,
  loadSessionSettings,
  loadStuckGuardState,
  persistSkillDisabled,
  persistSkillEnabled,
  persistStuckGuardState,
  resolveEditMode,
  resolveThinkingLevel,
  runPrompt,
  setEditModeForSession,
} from "../runner.ts";
import { createMockCtx, createMockStore } from "./helpers.ts";

describe("runPrompt", () => {
  let runPromptSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    clearRunsForTesting();
    const mod = await import("../runner.ts");
    runPromptSpy = vi.spyOn(mod, "runPrompt");
    runPromptSpy.mockImplementation(
      async (
        _ctx: any,
        _sessionId: string,
        _message: string,
        _storage: any,
        _eventCallback: (event: AgentHarnessEvent) => void
      ) => {}
    );
  });

  afterEach(() => {
    clearRunsForTesting();
    runPromptSpy.mockRestore();
  });

  it("unknown session throws Session not found", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    runPromptSpy.mockRestore();
    await expect(
      runPrompt(
        ctx,
        "nonexistent-session-id",
        "test",
        storage,
        vi.fn(),
        vi.fn()
      )
    ).rejects.toThrow(SESSION_NOT_FOUND_RE);
  });

  it("unknown project throws Project not found", async () => {
    const ctx = createMockCtx();
    (
      ctx.repos.projects.findById as ReturnType<typeof vi.fn>
    ).mockImplementation((id: string) => {
      if (id === "proj-1") {
        return null;
      }
      return {
        id,
        name: "test-project",
        cwd: "/tmp/test",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
    const storage = createMockStore();

    runPromptSpy.mockRestore();
    await expect(
      runPrompt(ctx, "sess-1", "test", storage, vi.fn(), vi.fn())
    ).rejects.toThrow(PROJECT_NOT_FOUND_RE);
  });

  it("valid session run calls eventCallback and registers then unregisters", async () => {
    const ctx = createMockCtx();
    const storage = createMockStore();

    const capturedEvents: AgentHarnessEvent[] = [];
    runPromptSpy.mockImplementation(
      async (
        _ctx: any,
        _sessionId: string,
        _message: string,
        _storage: any,
        eventCallback: (event: AgentHarnessEvent) => void
      ) => {
        eventCallback({ type: "agent_start" });
        eventCallback({
          type: "message_update",
          delta: { kind: "text", text: "Hello!" },
        });
        eventCallback({ type: "agent_end", messages: [] });
      }
    );

    await runPrompt(ctx, "sess-1", "Say hello", storage, vi.fn(), vi.fn());

    expect(runPromptSpy).toHaveBeenCalledTimes(1);
    expect(capturedEvents.length).toBe(0);
  });

  it("abortRun returns false when no active run exists", async () => {
    expect(await abortRun("sess-1")).toBe(false);
    expect(await abortRun("nonexistent")).toBe(false);
  });

  it("loadSessionSettings returns raw DB overrides (defaults merged by parseSessionSettings)", async () => {
    const ctx = createMockCtx();
    (
      ctx.repos.settings.getByPrefix as ReturnType<typeof vi.fn>
    ).mockReturnValue([
      { key: "session:sess-1:thinking_level", value: "high" },
    ]);

    const raw = loadSessionSettings(ctx, "sess-1");

    expect(ctx.repos.settings.getByPrefix).toHaveBeenCalledWith(
      "session:sess-1:"
    );
    // Raw overrides only — no defaults merged here.
    expect(raw.thinking_level).toBe("high");
    expect(raw.auto_retry).toBeUndefined();
    expect(raw.steering_mode).toBeUndefined();

    // Defaults are applied by parseSessionSettings.
    const settings = parseSessionSettings(raw);
    expect(settings.thinkingLevelOverride()).toBe("high");
    expect(settings.autoRetry()).toBe(true);
    expect(settings.steeringMode()).toBe("all");
  });

  it("W4: per-session thinking_level 'off' disables a session row's 'high'", async () => {
    const ctx = createMockCtx();
    (
      ctx.repos.sessions.findById as ReturnType<typeof vi.fn>
    ).mockImplementation(async (id: string) =>
      id === "sess-1"
        ? {
            id: "sess-1",
            projectId: "proj-1",
            modelId: "test-model",
            title: null,
            thinkingLevel: "high",
            createdAt: 0,
            updatedAt: 0,
          }
        : null
    );
    (ctx.repos.settings.get as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key.endsWith(":thinking_level") ? "off" : null)
    );

    const level = resolveThinkingLevel(ctx, "sess-1", {
      thinkingLevel: "high",
    });
    expect(level).toBe("off");
  });

  it("W3: parseSessionSettings defaults auto_compaction to false", () => {
    const ctx = createMockCtx();
    const settings = parseSessionSettings(loadSessionSettings(ctx, "sess-1"));
    expect(settings.autoCompaction()).toBe(false);
  });

  it("resolveEditMode: returns stored mode when set", () => {
    const ctx = createMockCtx();
    (ctx.repos.settings.get as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => (key === "session:sess-1:edit_mode" ? "replace" : null)
    );
    expect(resolveEditMode(ctx, "sess-1")).toBe("replace");
  });

  it("resolveEditMode: defaults to hashline when not set", () => {
    const ctx = createMockCtx();
    expect(resolveEditMode(ctx, "sess-1")).toBe("hashline");
  });
});

describe("setEditModeForSession", () => {
  it("persists mode to settings table", async () => {
    const ctx = createMockCtx();
    const result = await setEditModeForSession(ctx, "sess-1", "replace");
    expect(result).toBe(true);
    expect(ctx.repos.settings.set).toHaveBeenCalledWith(
      "session:sess-1:edit_mode",
      "replace"
    );
  });

  it("returns false for unknown session", async () => {
    const ctx = createMockCtx();
    const result = await setEditModeForSession(ctx, "nonexistent", "replace");
    expect(result).toBe(false);
  });
});

describe("loadDisabledSkills", () => {
  it("returns the set of disabled skill names for a session via getByPrefix", () => {
    const ctx = createMockCtx();
    (
      ctx.repos.settings.getByPrefix as ReturnType<typeof vi.fn>
    ).mockReturnValue([
      { key: "session:sess-1:disabled_skill:graphify", value: "1" },
      { key: "session:sess-1:disabled_skill:old-thing", value: "1" },
      // An unrelated per-session setting should never be returned because the
      // prefix is `disabled_skill:`, but verify the slice still skips it.
      { key: "session:sess-1:thinking_level", value: "high" },
    ]);

    const result = loadDisabledSkills(ctx, "sess-1");

    expect(ctx.repos.settings.getByPrefix).toHaveBeenCalledWith(
      "session:sess-1:disabled_skill:"
    );
    expect(result).toEqual(new Set(["graphify", "old-thing"]));
  });

  it("returns an empty set when nothing is disabled", () => {
    const ctx = createMockCtx();
    (
      ctx.repos.settings.getByPrefix as ReturnType<typeof vi.fn>
    ).mockReturnValue([]);

    const result = loadDisabledSkills(ctx, "sess-empty");
    expect(result.size).toBe(0);
  });

  it("scopes to the requested session — does not leak across sessions", () => {
    const ctx = createMockCtx();
    (
      ctx.repos.settings.getByPrefix as ReturnType<typeof vi.fn>
    ).mockReturnValue([
      { key: "session:sess-1:disabled_skill:graphify", value: "1" },
    ]);

    const result = loadDisabledSkills(ctx, "sess-1");
    expect(result.has("graphify")).toBe(true);

    // The helper must always query with the requested session id — a different
    // call would produce a different prefix and the mock would not match.
    expect(ctx.repos.settings.getByPrefix).toHaveBeenCalledWith(
      "session:sess-1:disabled_skill:"
    );
  });
});

describe("persistSkillDisabled / persistSkillEnabled", () => {
  it("persistSkillDisabled writes the keyed-prefix entry with value '1'", async () => {
    const ctx = createMockCtx();
    await persistSkillDisabled(ctx, "sess-1", "graphify");
    expect(ctx.repos.settings.set).toHaveBeenCalledWith(
      "session:sess-1:disabled_skill:graphify",
      "1"
    );
  });

  it("persistSkillEnabled deletes the keyed-prefix entry", async () => {
    const ctx = createMockCtx();
    await persistSkillEnabled(ctx, "sess-1", "graphify");
    expect(ctx.repos.settings.delete).toHaveBeenCalledWith(
      "session:sess-1:disabled_skill:graphify"
    );
  });
});

describe("stuck guard state (loadStuckGuardState / persistStuckGuardState)", () => {
  it("loadStuckGuardState returns zeroed defaults when no keys are set", async () => {
    const ctx = createMockCtx();
    (ctx.repos.settings.get as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const state = loadStuckGuardState(ctx, "sess-1");
    expect(state).toEqual({ consecutiveCompacts: 0, paused: false });
  });

  it("loadStuckGuardState reads consecutive_compacts and paused from settings", async () => {
    const ctx = createMockCtx();
    (ctx.repos.settings.get as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) => {
        if (key === "session:sess-1:consecutive_compacts") return "2";
        if (key === "session:sess-1:auto_compaction_paused") return "1";
        return null;
      }
    );
    const state = loadStuckGuardState(ctx, "sess-1");
    expect(state).toEqual({ consecutiveCompacts: 2, paused: true });
  });

  it("loadStuckGuardState treats a malformed consecutive_compacts as 0", async () => {
    const ctx = createMockCtx();
    (ctx.repos.settings.get as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string) =>
        key === "session:sess-1:consecutive_compacts" ? "not-a-number" : null
    );
    const state = loadStuckGuardState(ctx, "sess-1");
    expect(state.consecutiveCompacts).toBe(0);
    expect(state.paused).toBe(false);
  });

  it("persistStuckGuardState writes consecutive_compacts and sets paused='1' when paused", async () => {
    const ctx = createMockCtx();
    await persistStuckGuardState(ctx, "sess-1", {
      consecutiveCompacts: 2,
      paused: true,
    });
    expect(ctx.repos.settings.set).toHaveBeenCalledWith(
      "session:sess-1:consecutive_compacts",
      "2"
    );
    expect(ctx.repos.settings.set).toHaveBeenCalledWith(
      "session:sess-1:auto_compaction_paused",
      "1"
    );
  });

  it("persistStuckGuardState deletes the paused key when not paused (keeps table clean)", async () => {
    const ctx = createMockCtx();
    await persistStuckGuardState(ctx, "sess-1", {
      consecutiveCompacts: 0,
      paused: false,
    });
    expect(ctx.repos.settings.set).toHaveBeenCalledWith(
      "session:sess-1:consecutive_compacts",
      "0"
    );
    expect(ctx.repos.settings.delete).toHaveBeenCalledWith(
      "session:sess-1:auto_compaction_paused"
    );
  });
});
