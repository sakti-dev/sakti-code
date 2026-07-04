import { createEffect, createResource, createSignal } from "solid-js";
import { Card } from "~/components/ui/card";
import { useStore } from "~/stores/store-context";

const DEFAULT_OBSERVATION_THRESHOLD = 30_000;
const DEFAULT_REFLECTION_THRESHOLD = 40_000;

interface OmSettings {
  observationThreshold?: number;
  reflectionThreshold?: number;
}

interface SettingsData {
  observationalMemory?: OmSettings;
}

export function MemorySettings() {
  const { api } = useStore();
  const [observationThreshold, setObservationThreshold] = createSignal(
    String(DEFAULT_OBSERVATION_THRESHOLD),
  );
  const [reflectionThreshold, setReflectionThreshold] = createSignal(
    String(DEFAULT_REFLECTION_THRESHOLD),
  );

  const [settingsResource] = createResource(async () => {
    const res = await api.api.settings.$get();
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as SettingsData;
  });

  createEffect(() => {
    const data = settingsResource();
    if (data === null) return;
    const om = data?.observationalMemory;
    if (om?.observationThreshold !== undefined) {
      setObservationThreshold(String(om.observationThreshold));
    }
    if (om?.reflectionThreshold !== undefined) {
      setReflectionThreshold(String(om.reflectionThreshold));
    }
  });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleThresholdSave = (
    key: "observationThreshold" | "reflectionThreshold",
    value: number,
  ) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void api.api.settings
        .$put({ json: { observationalMemory: { [key]: value } } })
        .catch(() => {});
    }, 600);
  };

  const onObservationThresholdChange = (raw: string) => {
    setObservationThreshold(raw);
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) {
      scheduleThresholdSave("observationThreshold", num);
    }
  };

  const onReflectionThresholdChange = (raw: string) => {
    setReflectionThreshold(raw);
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) {
      scheduleThresholdSave("reflectionThreshold", num);
    }
  };

  return (
    <Card class="p-4">
      <div class="mb-3">
        <h3 class="font-semibold text-sm tracking-tight">Observational Memory</h3>
        <p class="mt-0.5 text-muted-foreground text-xs">
          Background observer and reflector models that learn from the conversation and distill long
          context into searchable observations. Always on — configure the models per profile in the
          Models tab.
        </p>
      </div>

      <div class="mt-4 space-y-2">
        <div class="flex items-center gap-3">
          <label class="w-40 shrink-0 text-muted-foreground text-xs" for="om-observation-threshold">
            Observation threshold (tokens)
          </label>
          <input
            class="w-28 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-xs"
            data-testid="om-observation-threshold"
            id="om-observation-threshold"
            onInput={(e) => onObservationThresholdChange(e.currentTarget.value)}
            type="number"
            value={observationThreshold()}
          />
        </div>
        <div class="flex items-center gap-3">
          <label class="w-40 shrink-0 text-muted-foreground text-xs" for="om-reflection-threshold">
            Reflection threshold (tokens)
          </label>
          <input
            class="w-28 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-xs"
            data-testid="om-reflection-threshold"
            id="om-reflection-threshold"
            onInput={(e) => onReflectionThresholdChange(e.currentTarget.value)}
            type="number"
            value={reflectionThreshold()}
          />
        </div>
      </div>
    </Card>
  );
}
