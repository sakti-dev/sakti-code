import { useColorMode } from "@kobalte/core";
import {
  type Component,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

interface ApiKeyInfo {
  envVar: string;
  hasKey: boolean;
  maskedKey: string | null;
  provider: string;
}

type ThemeChoice = "light" | "dark" | "system";

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function CheckIcon() {
  return (
    <svg
      aria-label="Selected"
      class="ml-auto h-4 w-4 shrink-0 text-foreground"
      fill="currentColor"
      role="img"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Selected</title>
      <path
        clip-rule="evenodd"
        d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207z"
      />
    </svg>
  );
}

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

const ApiKeyRow: Component<{
  apiKey: ApiKeyInfo;
  onSave: (provider: string, key: string) => Promise<void>;
  onDelete: (provider: string) => Promise<void>;
}> = (props) => {
  const [editing, setEditing] = createSignal(false);
  const [value, setValue] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  const label = () =>
    PROVIDER_LABELS[props.apiKey.provider] ?? props.apiKey.provider;

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

  const handleDelete = async () => {
    await props.onDelete(props.apiKey.provider);
    setEditing(false);
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
            placeholder={`${props.apiKey.envVar}`}
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

export default function SettingsDialog() {
  const { colorMode, setColorMode } = useColorMode();

  const [keys, { refetch }] = createResource(async () => {
    const res = await fetch("/api/api-keys/");
    if (!res.ok) {
      return [] as ApiKeyInfo[];
    }
    return (await res.json()) as ApiKeyInfo[];
  });

  const currentChoice = (): ThemeChoice => {
    const stored = localStorage.getItem("sakti-theme");
    if (stored === '"system"' || stored === "system") {
      return "system";
    }
    return colorMode() as ThemeChoice;
  };

  const handleSelectTheme = (choice: ThemeChoice) => {
    if (choice === "system") {
      localStorage.setItem("sakti-theme", '"system"');
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      setColorMode(prefersDark ? "dark" : "light");
    } else {
      localStorage.setItem("sakti-theme", `"${choice}"`);
      setColorMode(choice);
    }
  };

  const handleSaveKey = async (provider: string, key: string) => {
    await fetch(`/api/api-keys/${provider}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    refetch();
  };

  const handleDeleteKey = async (provider: string) => {
    await fetch(`/api/api-keys/${provider}`, { method: "DELETE" });
    refetch();
  };

  const hasAnyKey = () => keys()?.some((k) => k.hasKey) ?? false;

  return (
    <Dialog>
      <DialogTrigger
        class="flex items-center gap-1.5 rounded-md border-border bg-card px-2 py-1 font-medium text-foreground text-xs transition-colors hover:border-muted-foreground hover:bg-secondary"
        title="Settings"
      >
        <svg
          aria-label="Settings"
          class="h-3.5 w-3.5"
          fill="currentColor"
          role="img"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Settings</title>
          <path
            clip-rule="evenodd"
            d="M6.955 1.45A.5.5 0 0 1 7.452 1h1.096a.5.5 0 0 1 .497.45l.17 1.699c.484.12.94.312 1.356.562l1.321-.832a.5.5 0 0 1 .67.065l.774.775a.5.5 0 0 1 .066.67l-.832 1.32c.25.417.443.873.563 1.357l1.699.17a.5.5 0 0 1 .45.496v1.096a.5.5 0 0 1-.45.497l-1.699.17c-.12.484-.312.94-.562 1.356l.832 1.321a.5.5 0 0 1-.066.67l-.774.774a.5.5 0 0 1-.67.066l-1.32-.832c-.417.25-.873.443-1.357.563l-.17 1.699a.5.5 0 0 1-.497.45H7.452a.5.5 0 0 1-.497-.45l-.17-1.699a4.973 4.973 0 0 1-1.356-.562l-1.321.832a.5.5 0 0 1-.67-.066l-.774-.774a.5.5 0 0 1-.066-.67l.832-1.32a4.972 4.972 0 0 1-.563-1.357l-1.699-.17A.5.5 0 0 1 1 8.548V7.452a.5.5 0 0 1 .45-.497l1.699-.17c.12-.484.312-.94.562-1.356l-.832-1.321a.5.5 0 0 1 .066-.67l.774-.774a.5.5 0 0 1 .67-.066l1.32.832c.417-.25.873-.443 1.357-.563l.17-1.699zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
          />
        </svg>
      </DialogTrigger>
      <DialogContent class="max-w-lg">
        <DialogTitle class="text-sm">Settings</DialogTitle>
        <DialogDescription class="sr-only">
          Configure application preferences
        </DialogDescription>

        <div class="mt-2 flex flex-col gap-6">
          {/* API Keys */}
          <section>
            <div class="mb-2 flex items-center justify-between">
              <h3 class="font-semibold text-foreground text-sm">API Keys</h3>
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
          </section>

          <div class="border-border border-t" />

          {/* Appearance */}
          <section>
            <h3 class="mb-3 font-semibold text-foreground text-sm">
              Appearance
            </h3>
            <span class="mb-2 block font-medium text-muted-foreground text-xs">
              Theme
            </span>
            <div class="flex flex-col gap-1.5">
              <For each={THEME_OPTIONS}>
                {(opt) => (
                  <button
                    class={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2 transition-all",
                      currentChoice() === opt.value
                        ? "border-primary bg-secondary"
                        : "border-border hover:border-muted-foreground hover:bg-secondary"
                    )}
                    onClick={() => handleSelectTheme(opt.value)}
                    type="button"
                  >
                    <span
                      class={cn(
                        "font-medium text-xs",
                        currentChoice() === opt.value
                          ? "text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {opt.label}
                    </span>
                    <Show when={currentChoice() === opt.value}>
                      <CheckIcon />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </section>
        </div>

        <div class="mt-4 border-border border-t pt-3">
          <p class="text-[10px] text-muted-foreground/70">
            Settings are saved automatically.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
