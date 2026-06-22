import type { Component } from "solid-js";
import { createResource, createSignal, For, Show } from "solid-js";
import { cn } from "~/lib/utils";

interface ApiKeyInfo {
  envVar: string;
  hasKey: boolean;
  maskedKey: string | null;
  provider: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  cerebras: "Cerebras",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  google: "Google (Gemini)",
  groq: "Groq",
  huggingface: "Hugging Face",
  mistral: "Mistral",
  openai: "OpenAI",
  opencode: "OpenCode",
  openrouter: "OpenRouter",
  together: "Together",
  xai: "xAI",
  zai: "ZAI",
};

function StatusDot(props: { hasKey: boolean }) {
  return (
    <span
      class={cn(
        "h-2 w-2 shrink-0 rounded-full",
        props.hasKey ? "bg-green-500" : "bg-muted-foreground/30"
      )}
      title={props.hasKey ? "Key set" : "No key"}
    />
  );
}

const ApiKeyRow: Component<{
  apiKey: ApiKeyInfo;
  onDelete: (provider: string) => Promise<void>;
  onSave: (provider: string, key: string) => Promise<void>;
}> = (props) => {
  const [editing, setEditing] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [value, setValue] = createSignal("");

  const label = () =>
    PROVIDER_LABELS[props.apiKey.provider] ?? props.apiKey.provider;

  const handleDelete = async () => {
    await props.onDelete(props.apiKey.provider);
    setEditing(false);
  };

  const handleSave = async () => {
    const key = value().trim();
    if (!key) {
      return;
    }
    setSaving(true);
    try {
      await props.onSave(props.apiKey.provider, key);
      setValue("");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="flex items-center gap-2 py-1.5">
      <StatusDot hasKey={props.apiKey.hasKey} />
      <div class="min-w-0 flex-1">
        <span class="font-medium text-foreground text-xs">{label()}</span>
        <Show when={props.apiKey.maskedKey}>
          <span class="ml-2 text-[10px] text-muted-foreground/70 tabular-nums">
            {props.apiKey.maskedKey}
          </span>
        </Show>
      </div>
      <Show
        fallback={
          <div class="flex items-center gap-1">
            <Show when={props.apiKey.hasKey}>
              <button
                class="rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                onClick={handleDelete}
                title="Remove key"
                type="button"
              >
                Remove
              </button>
            </Show>
            <button
              class="rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              onClick={() => setEditing(true)}
              type="button"
            >
              {props.apiKey.hasKey ? "Update" : "Add key"}
            </button>
          </div>
        }
        when={editing()}
      >
        <div class="flex items-center gap-1">
          <input
            autocomplete="off"
            class="w-48 rounded border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-primary"
            onInput={(e) => setValue(e.currentTarget.value)}
            placeholder={props.apiKey.envVar}
            spellcheck={false}
            type="password"
            value={value()}
          />
          <button
            class="rounded bg-primary px-2 py-1 font-medium text-[11px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            disabled={!value().trim() || saving()}
            onClick={handleSave}
            type="button"
          >
            {saving() ? "Saving..." : "Save"}
          </button>
          <button
            class="rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={() => {
              setValue("");
              setEditing(false);
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      </Show>
    </div>
  );
};

export function ModelsSettings() {
  const [keys, { refetch }] = createResource(async () => {
    const res = await fetch("/api/api-keys/");
    if (!res.ok) {
      return [] as ApiKeyInfo[];
    }
    return (await res.json()) as ApiKeyInfo[];
  });

  const handleDeleteKey = async (provider: string) => {
    await fetch(`/api/api-keys/${provider}`, { method: "DELETE" });
    refetch();
  };

  const handleSaveKey = async (provider: string, key: string) => {
    await fetch(`/api/api-keys/${provider}`, {
      body: JSON.stringify({ key }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    refetch();
  };

  const hasAnyKey = () => keys()?.some((k) => k.hasKey) ?? false;

  return (
    <div class="space-y-4">
      <div class="rounded-lg border border-border p-4">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-semibold text-foreground text-sm">Providers</h3>
          <Show
            fallback={
              <span class="text-[10px] text-yellow-500">
                No keys configured
              </span>
            }
            when={hasAnyKey()}
          >
            <span class="text-[10px] text-green-500">
              {keys()?.filter((k) => k.hasKey).length} provider(s) active
            </span>
          </Show>
        </div>
        <p class="mb-3 text-muted-foreground text-xs">
          Keys are stored locally at{" "}
          <code class="rounded bg-secondary px-1 py-0.5 font-mono text-[10px]">
            ~/.config/sakti-code/api-keys.json
          </code>
        </p>
        <div class="rounded-lg border border-border p-3">
          <For each={keys() ?? []}>
            {(keyInfo) => (
              <ApiKeyRow
                apiKey={keyInfo}
                onDelete={handleDeleteKey}
                onSave={handleSaveKey}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
