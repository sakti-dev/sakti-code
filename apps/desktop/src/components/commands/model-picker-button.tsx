import { Show } from "solid-js";
import { createLogger } from "~/lib/utils";
import { useModelPicker } from "./hooks";
import { ModelSelectorDialog } from "./model-selector-dialog";

const pickerLog = createLogger({ module: "ModelPickerButton" });

export interface ModelPickerButtonProps {
  onSelect: (model: {
    id: string;
    provider: string;
    reasoning: boolean;
  }) => void;
  triggerLabel: () => string;
  value: string;
}

export function ModelPickerButton(props: ModelPickerButtonProps) {
  const {
    isOpen,
    setIsOpen,
    searchQuery,
    setSearchQuery,
    modelSections,
    rawModelSections,
  } = useModelPicker();

  return (
    <Show when={rawModelSections().some((s) => s.models.length > 0)}>
      <div class="flex flex-col items-end gap-0.5">
        <button
          aria-label="Open model selector"
          class="flex h-7 flex-1 items-center justify-between gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-xs transition-colors hover:bg-muted/60"
          onClick={() => {
            setSearchQuery("");
            setIsOpen((open) => {
              pickerLog.info("dialog toggle", { to: !open });
              return !open;
            });
          }}
          type="button"
        >
          <span class="truncate">{props.triggerLabel()}</span>
          <svg
            aria-label="Toggle model list"
            class="size-3 shrink-0 text-muted-foreground"
            fill="currentColor"
            role="img"
            viewBox="0 0 16 16"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Toggle model list</title>
            <path
              clip-rule="evenodd"
              d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06z"
            />
          </svg>
        </button>
        <ModelSelectorDialog
          modelSections={modelSections()}
          onOpenChange={(v) => {
            pickerLog.info("onOpenChange", {
              to: v,
              stack: new Error("trace").stack
                ?.split("\n")
                .slice(2, 5)
                .join(" | "),
            });
            setIsOpen(v);
          }}
          onSearchChange={setSearchQuery}
          onSelect={(modelId, providerId, reasoning) => {
            props.onSelect({
              id: modelId,
              provider: providerId,
              reasoning,
            });
            setIsOpen(false);
          }}
          open={isOpen()}
          searchQuery={searchQuery()}
          selectedModelId={props.value || undefined}
        />
      </div>
    </Show>
  );
}
