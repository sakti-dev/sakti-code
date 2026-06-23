import { For } from "solid-js";

interface Suggestion {
  icon: string;
  label: string;
  prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: "\u{1F4A1}",
    label: "New feature",
    prompt: "I want to add a new feature",
  },
  {
    icon: "\u{1F41B}",
    label: "Bug fix",
    prompt: "I found a bug",
  },
  {
    icon: "\u{1F52C}",
    label: "Research",
    prompt: "Help me understand this codebase",
  },
];

export function WelcomePanel() {
  return (
    <div class="flex flex-1 flex-col items-center justify-center px-4">
      <div class="w-full max-w-md text-center">
        <div class="mb-3 text-4xl">{"\u{1F967}"}</div>
        <h2 class="mb-1 font-semibold text-foreground text-lg">
          How can I help?
        </h2>
        <p class="mb-6 text-muted-foreground text-sm">
          Describe a feature, bug, or question. We'll plan it together before
          starting a session.
        </p>
        <div class="grid grid-cols-1 gap-2">
          <For each={SUGGESTIONS}>
            {(s) => (
              <div class="flex items-center gap-3 rounded-lg border border-border p-3 text-left text-sm hover:bg-muted">
                <span class="text-xl">{s.icon}</span>
                <span class="text-foreground">{s.label}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
