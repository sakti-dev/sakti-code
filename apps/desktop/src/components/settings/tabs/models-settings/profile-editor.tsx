import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { ModelPickerButton } from "~/components/commands/model-seletor/model-picker-button";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { TextField, TextFieldInput } from "~/components/ui/text-field";
import { useStore } from "~/stores/store-context";

const MODES = ["default", "intake", "plan", "build"] as const;
const MODE_LABELS: Record<string, string> = {
  default: "Default",
  intake: "Intake",
  plan: "Plan",
  build: "Build",
};
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

interface ModelRef {
  model: string;
  provider: string;
  thinkingLevel?: string;
}

interface ProfileEntry {
  models: Record<string, ModelRef>;
  name: string;
}

interface ProfilesData {
  defaultProfile: string;
  profiles: Record<string, ProfileEntry>;
}

export function ProfileEditor() {
  const { api } = useStore();
  const [localProfiles, setLocalProfiles] = createSignal<ProfilesData | null>(null);

  const [profilesResource] = createResource(async () => {
    const res = await api.api.profiles.$get();
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as ProfilesData;
  });

  const thinkingOptionIds = () => [...THINKING_LEVELS];

  createEffect(() => {
    const p = profilesResource();
    if (p) {
      setLocalProfiles(p);
    }
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const p = localProfiles();
      if (!p) {
        return;
      }
      api.api.profiles.$put({ json: p });
    }, 800);
  };

  const profileEntries = createMemo(() => {
    const p = localProfiles();
    if (!p) {
      return [];
    }
    return Object.entries(p.profiles);
  });

  const isDefault = (profileId: string) => {
    const p = localProfiles();
    return p?.defaultProfile === profileId;
  };

  const updateProfile = (profileId: string, update: Partial<ProfileEntry>) => {
    setLocalProfiles((prev) => {
      if (!prev) {
        return prev;
      }
      const existing = prev.profiles[profileId];
      if (!existing) {
        return prev;
      }
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

  const updateModeModel = (
    profileId: string,
    mode: string,
    model: { id: string; provider: string; reasoning: boolean },
  ) => {
    const p = localProfiles();
    if (!p) {
      return;
    }
    const current = p.profiles[profileId]?.models[mode];
    const profileModels = p.profiles[profileId]?.models;
    if (!profileModels) {
      return;
    }
    const defaultThinking = model.reasoning ? "high" : "off";
    const models = {
      ...profileModels,
      [mode]: {
        provider: model.provider,
        model: model.id,
        thinkingLevel: current?.thinkingLevel ?? defaultThinking,
      },
    };
    updateProfile(profileId, { models });
  };

  const updateModeThinking = (profileId: string, mode: string, level: string) => {
    const p = localProfiles();
    if (!p) {
      return;
    }
    const current = p.profiles[profileId]?.models[mode];
    if (!current) {
      return;
    }
    const profileModels = p.profiles[profileId]?.models;
    if (!profileModels) {
      return;
    }
    const models = {
      ...profileModels,
      [mode]: { ...current, thinkingLevel: level },
    };
    updateProfile(profileId, { models });
  };

  const addProfile = () => {
    setLocalProfiles((prev) => {
      if (!prev) {
        return prev;
      }
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
      if (!prev) {
        return prev;
      }
      const rest = { ...prev.profiles };
      delete rest[profileId];
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
      if (!prev) {
        return prev;
      }
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
    <Show keyed when={localProfiles()}>
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
                <div class="mb-3 flex items-center justify-between gap-3">
                  <div class="flex min-w-0 flex-1 items-center gap-2">
                    <TextField class="contents">
                      <TextFieldInput
                        class="min-w-0 flex-1 font-medium"
                        onInput={(e) =>
                          updateProfile(profileId, {
                            name: e.currentTarget.value,
                          })
                        }
                        type="text"
                        value={profile.name}
                      />
                    </TextField>
                    <Show when={isDefault(profileId)}>
                      <span class="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary uppercase tracking-wide">
                        Default
                      </span>
                    </Show>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
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
                        class="text-destructive text-xs hover:text-destructive"
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
                          <span class="w-16 shrink-0 font-medium text-muted-foreground text-xs">
                            {MODE_LABELS[mode]}
                          </span>
                          <ModelPickerButton
                            onSelect={(model) => updateModeModel(profileId, mode, model)}
                            triggerLabel={() => modelId() || "Select model"}
                            value={modelId()}
                          />
                          <Select
                            itemComponent={(props) => (
                              <SelectItem class="capitalize" item={props.item}>
                                {props.item.rawValue}
                              </SelectItem>
                            )}
                            onChange={(value) => {
                              if (value !== null) {
                                updateModeThinking(profileId, mode, value);
                              }
                            }}
                            options={thinkingOptionIds()}
                            value={thinkingLevel()}
                          >
                            <SelectTrigger class="h-7 w-20 shrink-0 gap-1 rounded-md border-border/60 bg-background/70 px-2 py-1 text-xs capitalize">
                              <SelectValue<string>>{thinkingLevel()}</SelectValue>
                            </SelectTrigger>
                            <SelectContent />
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
