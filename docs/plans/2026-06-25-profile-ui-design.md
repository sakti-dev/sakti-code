# Profile UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the profile picker (chat input) and profile management form (settings) so users can create, edit, switch, and delete profiles.

**Architecture:** Replace the chat input's `ModelSelectorButton` with a compact `ProfileSelect` dropdown using the existing Kobalte `<Select>` component. Add a card-based profile editor section to the `ModelsSettings` tab. Hide the top toolbar (planned for removal). All profile data flows through `GET/PUT /api/profiles` (whole-file CRUD). Session profile switching uses the existing `selectProfile` store action.

**Tech Stack:** SolidJS, Kobalte `Select`, Hono RPC typed client, existing `Select`/`SelectTrigger`/`SelectContent`/`SelectItem` UI primitives from `~/components/ui/select`.

---

## Context

### Profiles data shape (`GET /api/profiles`)

```typescript
interface Profiles {
  defaultProfile: string; // key into profiles map
  profiles: Record<string, Profile>;
}
interface Profile {
  name: string;
  models: {
    default: ModelRef; // required
    intake?: ModelRef;
    plan?: ModelRef;
    build?: ModelRef;
  };
  hybrid?: { enabled: boolean; vision?: { provider: string; model: string } };
}
interface ModelRef {
  provider: string; // e.g. "anthropic"
  model: string; // e.g. "claude-sonnet-4-20250514"
  thinkingLevel?: string; // "off" | "low" | "medium" | "high"
}
```

### Available models catalog

- `GET /api/models/available` → `string[]` (provider names)
- `GET /api/models/available/:provider` → `Model[]` (`{ id, name, provider, contextWindow, reasoning, input }`)
- `GET /api/auth` → `ApiKeyInfo[]` (`{ hasKey, maskedKey, provider }`) to determine connected providers

### Store actions

- `selectProfile(sessionId, profileId)` — PATCHes `/api/sessions/:id` with `{ profileId }`, updates local store
- `updateSession(sessionId, patch)` — merges partial `SessionMeta` updates locally

### `SessionMeta.profileId`

- `string | null` — when null, server falls back to `profiles.defaultProfile`

### Existing UI components to reuse

- `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectLabel`, `SelectValue` from `~/components/ui/select`
- `Card` from `~/components/ui/card`
- `Button` from `~/components/ui/button`

---

### Task 1: Hide the toolbar

**Files:**

- Modify: `apps/desktop/src/components/layout/workspace-layout.tsx:88`

**Step 1: Wrap `<Toolbar />` in a `Show when={false}`**

In `workspace-layout.tsx` line 88, change:

```tsx
<Toolbar />
```

to:

```tsx
<Show when={false}>
  <Toolbar />
</Show>
```

**Step 2: Verify no visual toolbar in the app**

Run: `cd apps/desktop && nub run dev`
Expected: Toolbar no longer renders. No other layout changes.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/layout/workspace-layout.tsx
git commit -m "chore(desktop): hide top toolbar (planned for removal)"
```

---

### Task 2: Create `ProfileSelect` component

**Files:**

- Create: `apps/desktop/src/components/chat-input/profile-select.tsx`
- Test: `apps/desktop/src/components/chat-input/__tests__/profile-select.test.tsx`

A reusable `<ProfileSelect>` using Kobalte `<Select>`. Shows profile name in trigger, list of profiles in dropdown. Calls `selectProfile` on change.

**Step 1: Write the failing test**

```typescript
// apps/desktop/src/components/chat-input/__tests__/profile-select.test.tsx
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileSelect } from "../profile-select";

const mocks = vi.hoisted(() => ({
  profiles.$get: vi.fn(),
  sessions: {} as Record<string, unknown>,
  selectProfile: vi.fn(),
}));

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    api: { api: { profiles: { $get: mocks.profiles.$get } } },
    server: {
      actions: { selectProfile: mocks.selectProfile },
      store: {
        activeSessionId: null,
        sessions: mocks.sessions,
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
    mocks.profiles.$get.mockReset();
    mocks.selectProfile.mockReset();
  });

  it("shows 'Select profile' when no session is active", async () => {
    mocks.profiles.$get.mockImplementation(() =>
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
      })
    );
    render(() => <ProfileSelect sessionId={null} />);
    expect(await screen.findByText("Select profile")).toBeTruthy();
  });

  it("shows profile names in dropdown when clicked", async () => {
    mocks.profiles.$get.mockImplementation(() =>
      profilesRes({
        defaultProfile: "default",
        profiles: {
          default: {
            name: "Default",
            models: { default: { provider: "anthropic", model: "claude-sonnet" } },
          },
        },
      })
    );
    render(() => <ProfileSelect sessionId="sess-1" />);
    fireEvent.click(await screen.findByRole("combobox"));
    expect(await screen.findByText("Default")).toBeTruthy();
  });

  it("calls selectProfile when a profile is clicked", async () => {
    mocks.profiles.$get.mockImplementation(() =>
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
      })
    );
    render(() => <ProfileSelect sessionId="sess-1" />);
    fireEvent.click(await screen.findByRole("combobox"));
    fireEvent.click(await screen.findByText("Fast"));
    await vi.waitFor(() => {
      expect(mocks.selectProfile).toHaveBeenCalledWith("sess-1", "fast");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && nub run test -- profile-select`
Expected: FAIL — module not found

**Step 3: Implement `ProfileSelect`**

```tsx
// apps/desktop/src/components/chat-input/profile-select.tsx
import { createResource, For, Show } from "solid-js";
import { useStore } from "~/stores/store-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

interface ProfileEntry {
  name: string;
  models: { default: { provider: string; model: string } };
}

export function ProfileSelect(props: { sessionId: string | null }) {
  const { api, server } = useStore();

  const [profiles] = createResource(async () => {
    const res = await api.api.profiles.$get();
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as {
      defaultProfile: string;
      profiles: Record<string, ProfileEntry>;
    } | null;
  });

  const profileEntries = () => {
    const p = profiles();
    if (!p) {
      return [];
    }
    return Object.entries(p.profiles);
  };

  const session = () => {
    const id = props.sessionId;
    return id ? server.store.sessions[id] : undefined;
  };

  const activeProfileId = () => {
    const s = session();
    if (!s) {
      return undefined;
    }
    const p = profiles();
    if (!p) {
      return undefined;
    }
    return s.profileId ?? p.defaultProfile;
  };

  const profileName = () => {
    const id = activeProfileId();
    if (!id) {
      return "Select profile";
    }
    const p = profiles();
    const entry = p?.profiles[id];
    return entry?.name ?? id;
  };

  const handleChange = (value: string) => {
    server.actions.selectProfile(props.sessionId, value);
  };

  return (
    <Show when={profileEntries().length > 0}>
      <Select
        defaultValue={activeProfileId()}
        disabled={!props.sessionId}
        onChange={handleChange}
        options={profileEntries().map(([id]) => id)}
        value={activeProfileId()}
      >
        <SelectTrigger class="h-7 gap-1 rounded-md border border-border/50 bg-transparent px-2 py-1 text-xs hover:bg-muted/50 focus:ring-1 focus:ring-primary/30 focus:ring-offset-0">
          <SelectValue>{profileName()}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <For each={profileEntries()}>
            {([id, profile]) => (
              <SelectItem value={id}>
                <span>{profile.name}</span>
              </SelectItem>
            )}
          </For>
        </SelectContent>
      </Select>
    </Show>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && nub run test -- profile-select`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add apps/desktop/src/components/chat-input/profile-select.tsx apps/desktop/src/components/chat-input/__tests__/profile-select.test.tsx
git commit -m "feat(desktop): add ProfileSelect dropdown component"
```

---

### Task 3: Wire `ProfileSelect` into chat input

**Files:**

- Modify: `apps/desktop/src/components/chat-input/chat-input.tsx:5,99`

**Step 1: Replace `ModelSelectorButton` import and usage**

In `chat-input.tsx`:

- Change line 5 from `import { ModelSelectorButton } from "./model-selector-button"` to `import { ProfileSelect } from "./profile-select"`
- Change line 99 from `<ModelSelectorButton sessionId={props.sessionId} />` to `<ProfileSelect sessionId={props.sessionId} />`

**Step 2: Run existing tests**

Run: `cd apps/desktop && nub run test -- chat-input`
Expected: PASS (existing tests still pass; they mock the component or test at a higher level)

**Step 3: Commit**

```bash
git add apps/desktop/src/components/chat-input/chat-input.tsx
git commit -m "feat(desktop): replace ModelSelectorButton with ProfileSelect in chat input"
```

---

### Task 4: Create `ProfileEditor` component for settings

**Files:**

- Create: `apps/desktop/src/components/settings/tabs/profile-editor.tsx`
- Create: `apps/desktop/src/components/settings/tabs/__tests__/profile-editor.test.tsx`

A form component that displays a list of profile cards. Each card has:

- Editable name input
- "Default" badge for the default profile
- 4 mode rows: mode label + model `<Select>` + thinking level `<Select>`
- "Set as default" / "Delete" actions
- An "Add profile" button at the bottom
- Auto-saves on changes (debounced `PUT /api/profiles`)

**Step 1: Write the failing test**

```typescript
// apps/desktop/src/components/settings/tabs/__tests__/profile-editor.test.tsx
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileEditor } from "../profile-editor";

const mocks = vi.hoisted(() => ({
  profilesGet: vi.fn(),
  profilesPut: vi.fn(),
  modelsGet: vi.fn(),
  modelsProviderGet: vi.fn(),
  authGet: vi.fn(),
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
            $get: mocks.modelsGet,
            ":provider": { $get: mocks.modelsProviderGet },
          },
        },
        auth: { $get: mocks.authGet },
      },
    },
  }),
}));

function profilesRes(data: unknown) {
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
    mocks.modelsGet.mockReset();
    mocks.modelsProviderGet.mockReset();
    mocks.authGet.mockReset();
  });

  it("renders profile cards on load", async () => {
    mocks.profilesGet.mockImplementation(() => profilesRes(defaultProfiles));
    mocks.modelsGet.mockImplementation(() => profilesRes(["anthropic"]));
    mocks.authGet.mockImplementation(() =>
      profilesRes([{ provider: "anthropic", hasKey: true, maskedKey: "...XXXX" }])
    );
    mocks.modelsProviderGet.mockImplementation(() =>
      profilesRes([
        { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", contextWindow: 200000, reasoning: false, input: [] },
      ])
    );
    render(() => <ProfileEditor />);
    expect(await screen.findByText("Default")).toBeTruthy();
    expect(await screen.findByText("Default profile")).toBeTruthy();
  });

  it("shows 'Add profile' button", async () => {
    mocks.profilesGet.mockImplementation(() => profilesRes(defaultProfiles));
    mocks.modelsGet.mockImplementation(() => profilesRes([]));
    mocks.authGet.mockImplementation(() => profilesRes([]));
    render(() => <ProfileEditor />);
    expect(await screen.findByText("Add profile")).toBeTruthy();
  });

  it("adds a new profile when 'Add profile' is clicked", async () => {
    mocks.profilesGet.mockImplementation(() => profilesRes(defaultProfiles));
    mocks.modelsGet.mockImplementation(() => profilesRes([]));
    mocks.authGet.mockImplementation(() => profilesRes([]));
    mocks.profilesPut.mockImplementation(() => okPut());
    render(() => <ProfileEditor />);
    fireEvent.click(await screen.findByText("Add profile"));
    await vi.waitFor(() => {
      expect(mocks.profilesPut).toHaveBeenCalled();
    });
    const putCall = mocks.profilesPut.mock.calls[0];
    const body = putCall[0]?.json;
    expect(Object.keys(body.profiles)).toContain("new-profile");
  });

  it("saves changes when profile name is edited", async () => {
    mocks.profilesGet.mockImplementation(() => profilesRes(defaultProfiles));
    mocks.modelsGet.mockImplementation(() => profilesRes(["anthropic"]));
    mocks.authGet.mockImplementation(() =>
      profilesRes([{ provider: "anthropic", hasKey: true, maskedKey: "...XXXX" }])
    );
    mocks.modelsProviderGet.mockImplementation(() =>
      profilesRes([
        { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", contextWindow: 200000, reasoning: false, input: [] },
      ])
    );
    mocks.profilesPut.mockImplementation(() => okPut());
    render(() => <ProfileEditor />);
    const nameInput = (await screen.findByDisplayValue("Default")) as HTMLInputElement;
    nameInput.value = "My Default";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(mocks.profilesPut).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && nub run test -- profile-editor`
Expected: FAIL — module not found

**Step 3: Implement `ProfileEditor`**

This is the largest component. Key implementation notes:

- Fetches profiles, available models, and auth states on mount via `createResource`
- Stores a local reactive copy of the `Profiles` object; mutations edit in-memory, then debounced save via `PUT /api/profiles`
- Model selects use a flat list of `{ modelId, modelName, providerId }` for all connected providers, grouped by `<SelectLabel>` per provider
- Thinking level is a simple `<Select>` with options `off`, `low`, `medium`, `high`
- Modes: iterate over `["default", "intake", "plan", "build"]`, show the mode label and its model/thinking selects. Empty mode slots inherit from `default`.
- Generate new profile IDs with a counter: `new-profile-${Date.now()}`

```tsx
// apps/desktop/src/components/settings/tabs/profile-editor.tsx
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { useStore } from "~/stores/store-context";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

const MODES = ["default", "intake", "plan", "build"] as const;
const MODE_LABELS: Record<string, string> = {
  default: "Default",
  intake: "Intake",
  plan: "Plan",
  build: "Build",
};
const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export function ProfileEditor() {
  const { api } = useStore();
  const [localProfiles, setLocalProfiles] = createSignal<Awaited<
    ReturnType<typeof fetchProfiles>
  > | null>(null);

  const [profilesResource] = createResource(fetchProfiles);
  const [availableModels] = createResource(fetchAvailableModels);

  const [authStates] = createResource(async () => {
    const res = await api.api.auth.$get();
    if (!res.ok) return [];
    return (await res.json()) as Array<{ provider: string; hasKey: boolean }>;
  });

  const connectedProviders = createMemo(() => {
    const states = authStates();
    if (!states) return new Set<string>();
    return new Set(states.filter((s) => s.hasKey).map((s) => s.provider));
  });

  const modelList = createMemo(() => {
    const models = availableModels();
    if (!models) return [];
    const connected = connectedProviders();
    const result: ModelInfo[] = [];
    for (const [provider, providerModels] of Object.entries(models)) {
      if (!connected.has(provider)) continue;
      for (const m of providerModels) {
        result.push({ id: m.id, name: m.name || m.id, provider });
      }
    }
    return result;
  });

  const modelsByProvider = createMemo(() => {
    const list = modelList();
    const map = new Map<string, ModelInfo[]>();
    for (const m of list) {
      const existing = map.get(m.provider);
      if (existing) existing.push(m);
      else map.set(m.provider, [m]);
    }
    return map;
  });

  const sortedProviders = createMemo(() => Array.from(modelsByProvider().keys()).sort());

  // Sync resource → local signal
  createEffect(() => {
    const p = profilesResource();
    if (p) setLocalProfiles(p);
  });

  // Debounced save
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const p = localProfiles();
      if (!p) return;
      api.api.profiles.$put({ json: p });
    }, 800);
  };

  const profileEntries = createMemo(() => {
    const p = localProfiles();
    if (!p) return [];
    return Object.entries(p.profiles);
  });

  const isDefault = (profileId: string) => {
    const p = localProfiles();
    return p?.defaultProfile === profileId;
  };

  const updateProfile = (profileId: string, update: Partial<ProfileEntry>) => {
    setLocalProfiles((prev) => {
      if (!prev) return prev;
      const existing = prev.profiles[profileId];
      if (!existing) return prev;
      return {
        ...prev,
        profiles: {
          ...prev.profiles,
          [profileId]: { ...existing, ...update },
        },
      };
    });
    scheduleSave();
  };

  const updateModeModel = (profileId: string, mode: string, modelId: string) => {
    const p = localProfiles();
    if (!p) return;
    const model = modelList().find((m) => m.id === modelId);
    if (!model) return;
    const current = p.profiles[profileId]?.models[mode];
    updateProfile(profileId, {
      models: {
        ...p.profiles[profileId].models,
        [mode]: {
          provider: model.provider,
          model: model.id,
          thinkingLevel: current?.thinkingLevel ?? "off",
        },
      },
    } as Partial<ProfileEntry>);
  };

  const updateModeThinking = (profileId: string, mode: string, level: string) => {
    const p = localProfiles();
    if (!p) return;
    const current = p.profiles[profileId]?.models[mode];
    if (!current) return;
    updateProfile(profileId, {
      models: {
        ...p.profiles[profileId].models,
        [mode]: { ...current, thinkingLevel: level },
      },
    } as Partial<ProfileEntry>);
  };

  const addProfile = () => {
    setLocalProfiles((prev) => {
      if (!prev) return prev;
      const id = `profile-${Date.now()}`;
      return {
        ...prev,
        profiles: {
          ...prev.profiles,
          [id]: {
            name: "New Profile",
            models: { default: { provider: "", model: "" } },
          },
        },
      };
    });
    scheduleSave();
  };

  const deleteProfile = (profileId: string) => {
    setLocalProfiles((prev) => {
      if (!prev) return prev;
      const { [profileId]: _, ...rest } = prev.profiles;
      const newDefault =
        prev.defaultProfile === profileId
          ? (Object.keys(rest)[0] ?? "default")
          : prev.defaultProfile;
      return { defaultProfile: newDefault, profiles: rest };
    });
    scheduleSave();
  };

  const setDefaultProfile = (profileId: string) => {
    setLocalProfiles((prev) => {
      if (!prev) return prev;
      return { ...prev, defaultProfile: profileId };
    });
    scheduleSave();
  };

  const getModeModelId = (profileId: string, mode: string): string => {
    const p = localProfiles();
    return p?.profiles[profileId]?.models[mode]?.model ?? "";
  };

  const getModeThinking = (profileId: string, mode: string): string => {
    const p = localProfiles();
    return p?.profiles[profileId]?.models[mode]?.thinkingLevel ?? "off";
  };

  return (
    <Show when={localProfiles()} keyed>
      <Card class="mt-4 p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold text-sm tracking-tight">Profiles</h3>
            <p class="mt-0.5 text-muted-foreground text-xs">
              Configure model profiles for different tasks.
            </p>
          </div>
          <button
            class="rounded-md border border-primary/30 bg-primary/12 px-3 py-1.5 font-medium text-primary text-xs transition-colors hover:bg-primary/18"
            onClick={addProfile}
            type="button"
          >
            Add profile
          </button>
        </div>

        <div class="mb-3 border-border/60 border-b" />

        <div class="space-y-3">
          <For each={profileEntries()}>
            {([profileId, profile]) => (
              <div class="rounded-lg border border-border/70 bg-background/50 p-3">
                <div class="flex items-center justify-between gap-3 mb-3">
                  <div class="flex items-center gap-2 min-w-0 flex-1">
                    <input
                      class="w-full min-w-0 rounded-md border border-border/70 bg-background px-2 py-1 text-sm font-medium outline-none focus:border-primary/45"
                      onInput={(e) => updateProfile(profileId, { name: e.currentTarget.value })}
                      type="text"
                      value={profile.name}
                    />
                    <Show when={isDefault(profileId)}>
                      <span class="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary uppercase tracking-wide">
                        Default
                      </span>
                    </Show>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <Show when={!isDefault(profileId)}>
                      <Button
                        class="text-xs"
                        onClick={() => setDefaultProfile(profileId)}
                        size="sm"
                        variant="ghost"
                      >
                        Set as default
                      </Button>
                    </Show>
                    <Show when={profileEntries().length > 1}>
                      <Button
                        class="text-xs text-destructive hover:text-destructive"
                        onClick={() => deleteProfile(profileId)}
                        size="sm"
                        variant="ghost"
                      >
                        Delete
                      </Button>
                    </Show>
                  </div>
                </div>

                <div class="space-y-2">
                  <For each={[...MODES]}>
                    {(mode) => {
                      const modelId = () => getModeModelId(profileId, mode);
                      const thinkingLevel = () => getModeThinking(profileId, mode);
                      return (
                        <div class="flex items-center gap-2">
                          <span class="w-16 shrink-0 text-muted-foreground text-xs font-medium">
                            {MODE_LABELS[mode]}
                          </span>
                          <Select
                            onChange={(value: string) => updateModeModel(profileId, mode, value)}
                            options={modelList().map((m) => m.id)}
                            value={modelId()}
                          >
                            <SelectTrigger class="h-7 flex-1 gap-1 rounded-md border-border/60 bg-background/70 px-2 py-1 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent class="max-h-[280px]">
                              <For each={sortedProviders()}>
                                {(provider) => (
                                  <>
                                    <SelectLabel class="text-[10px]">
                                      {provider.charAt(0).toUpperCase() + provider.slice(1)}
                                    </SelectLabel>
                                    <For each={modelsByProvider().get(provider) ?? []}>
                                      {(model) => (
                                        <SelectItem value={model.id}>{model.name}</SelectItem>
                                      )}
                                    </For>
                                  </>
                                )}
                              </For>
                            </SelectContent>
                          </Select>
                          <Select
                            onChange={(value: string) => updateModeThinking(profileId, mode, value)}
                            options={[...THINKING_LEVELS]}
                            value={thinkingLevel()}
                          >
                            <SelectTrigger class="h-7 w-20 shrink-0 gap-1 rounded-md border-border/60 bg-background/70 px-2 py-1 text-xs capitalize">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <For each={[...THINKING_LEVELS]}>
                                {(level) => (
                                  <SelectItem value={level} class="capitalize">
                                    {level}
                                  </SelectItem>
                                )}
                              </For>
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Card>
    </Show>
  );
}

type ProfileEntry = {
  name: string;
  models: Record<string, { provider: string; model: string; thinkingLevel?: string }>;
};

async function fetchProfiles() {
  const res = await api.api.profiles.$get(); // this won't work — need to pass client
  if (!res.ok) return null;
  return (await res.json()) as {
    defaultProfile: string;
    profiles: Record<string, ProfileEntry>;
  };
}

async function fetchAvailableModels(client: Client) {
  const providerRes = await client.api.models.available.$get();
  if (!providerRes.ok) return null;
  const providers = (await providerRes.json()) as string[];
  const result: Record<string, Array<{ id: string; name: string; provider: string }>> = {};
  for (const provider of providers) {
    const res = await client.api.models.available[":provider"].$get({ param: { provider } });
    if (res.ok) {
      result[provider] = (await res.json()) as Array<{
        id: string;
        name: string;
        provider: string;
      }>;
    }
  }
  return result;
}
```

> **NOTE:** The implementation above has a bug — `fetchProfiles` and `fetchAvailableModels` reference `api` from outside their scope. In the actual implementation, these must either be closures inside the component (capturing `api` from `useStore()`), or receive `api` as a parameter via the `createResource` source function pattern. Fix this by using the `createResource(() => source, fetcher)` two-argument pattern or by declaring the async functions inside the component body.

**Step 4: Run test to verify it passes**

Run: `cd apps/desktop && nub run test -- profile-editor`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add apps/desktop/src/components/settings/tabs/profile-editor.tsx apps/desktop/src/components/settings/tabs/__tests__/profile-editor.test.tsx
git commit -m "feat(desktop): add ProfileEditor card-based form for settings"
```

---

### Task 5: Wire `ProfileEditor` into `ModelsSettings`

**Files:**

- Modify: `apps/desktop/src/components/settings/tabs/models-settings.tsx`

**Step 1: Add import and render `ProfileEditor`**

In `models-settings.tsx`:

- Add import: `import { ProfileEditor } from "./profile-editor";`
- Insert `<ProfileEditor />` between the closing `</Card>` of the Providers section (line 548) and the Hybrid Vision `<Card>` (line 550):

```tsx
<ProfileEditor />
```

**Step 2: Run settings tests**

Run: `cd apps/desktop && nub run test -- models-settings`
Expected: PASS (existing provider tests still pass; `ProfileEditor` is rendered but not mocked since it fetches its own data)

Note: The existing test mocks `useStore` with only the `api.auth` path. Since `ProfileEditor` also accesses `api.profiles` and `api.models.available`, the mock needs to be extended. Update the mock in the existing test to include those paths returning empty data:

```typescript
vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    api: {
      api: {
        auth: {
          $get: mocks.$get,
          ":provider": {
            $post: mocks.$post,
            $delete: mocks.$delete,
          },
        },
        profiles: {
          $get: vi.fn().mockResolvedValue({
            ok: true,
            json: () =>
              Promise.resolve({
                defaultProfile: "default",
                profiles: {
                  default: { name: "Default", models: { default: { provider: "", model: "" } } },
                },
              }),
          }),
          $put: vi.fn().mockResolvedValue({ ok: true }),
        },
        models: {
          available: {
            $get: vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
            ":provider": {
              $get: vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
            },
          },
        },
      },
    },
  }),
}));
```

**Step 3: Commit**

```bash
git add apps/desktop/src/components/settings/tabs/models-settings.tsx apps/desktop/src/components/settings/tabs/__tests__/models-settings.test.tsx
git commit -m "feat(desktop): wire ProfileEditor into ModelsSettings tab"
```

---

### Task 6: Typecheck and run all tests

**Step 1: Run typecheck**

Run: `nub run typecheck`
Expected: All 5 packages pass with no errors.

**Step 2: Run all tests**

Run: `cd packages/db && nub run test && cd ../agent && nub run test && cd ../tools && nub run test && cd ../../apps/server && nub run test && cd ../desktop && nub run test`
Expected: db 36, agent 111, tools 48, server 214 (4 pre-existing failures), desktop 233+

**Step 3: Run ultracite fix**

Run: `nubx biome check --write packages/db/ apps/server/ apps/desktop/`
Expected: Clean, no remaining issues.

**Step 4: Commit any formatting fixes**

```bash
git add -A  # only if biome modified files
git commit -m "chore: format/lint fixes for profile UI"
```

---

### Task 7: Final commit of all profile UI work

This task is a checkpoint. If all tests pass and typecheck is clean, the feature is complete.

No additional code changes — just verify everything is green.

---

## Summary

| Task | What                                     | Files                                     |
| ---- | ---------------------------------------- | ----------------------------------------- |
| 1    | Hide toolbar                             | `workspace-layout.tsx`                    |
| 2    | Create `ProfileSelect` component + tests | `chat-input/profile-select.tsx`, test     |
| 3    | Wire `ProfileSelect` into chat input     | `chat-input.tsx`                          |
| 4    | Create `ProfileEditor` component + tests | `settings/tabs/profile-editor.tsx`, test  |
| 5    | Wire `ProfileEditor` into ModelsSettings | `settings/tabs/models-settings.tsx`, test |
| 6    | Typecheck + all tests + format           | All                                       |
| 7    | Final verification checkpoint            | —                                         |
