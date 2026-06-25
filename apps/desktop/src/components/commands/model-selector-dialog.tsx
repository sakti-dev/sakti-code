import { createEffect, For, Show } from "solid-js";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { cn, createLogger } from "~/lib/utils";

const dialogLog = createLogger({ module: "ModelSelectorDialog" });

import {
  MODEL_ROW_HEIGHT,
  type ModelHeadingRow,
  type ModelItemRow,
  type ModelSelectorSection,
  useModelSelector,
} from "./hooks";

export interface ModelSelectorDialogProps {
  modelSections: ModelSelectorSection[];
  onOpenChange: (open: boolean) => void;
  onSearchChange?: (query: string) => void;
  onSelect: (modelId: string, providerId: string, reasoning: boolean) => void;
  open: boolean;
  searchQuery?: string;
  selectedModelId?: string;
}

function statusBadge(
  status: "active" | "alpha" | "beta" | "deprecated" | undefined
) {
  if (status === undefined || status === "active") {
    return null;
  }
  const label = status === "deprecated" ? "deprecated" : status;
  const classes =
    status === "deprecated"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : "border-border bg-muted text-muted-foreground";
  return (
    <span
      class={`ml-2 shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${classes}`}
    >
      {label}
    </span>
  );
}

export function ModelSelectorDialog(props: ModelSelectorDialogProps) {
  createEffect(() => {
    dialogLog.debug("render", {
      modelSectionsCount: props.modelSections.length,
      modelSections: props.modelSections.map((s) => ({
        providerName: s.providerName,
        modelCount: s.models.length,
      })),
    });
  });

  const {
    query,
    setQuery,
    modelEntries,
    modelRows,
    visibleModelRows,
    handlePick,
    handleInputKeyDown,
    isActive,
    setModelScrollTop,
    registerSearchInput,
    registerModelList,
  } = useModelSelector({
    modelSections: props.modelSections,
    open: props.open,
    searchQuery: props.searchQuery,
    selectedModelId: props.selectedModelId,
    onSearchChange: props.onSearchChange,
    onSelect: props.onSelect,
    onOpenChange: props.onOpenChange,
  });

  return (
    <CommandDialog
      contentClass="model-selector-shell overflow-hidden rounded-xl border border-border/70 bg-popover/95 p-0 shadow-2xl"
      onOpenChange={props.onOpenChange}
      open={props.open}
    >
      <div class="model-selector-aurora pointer-events-none absolute inset-0" />
      <div class="model-selector-grain pointer-events-none absolute inset-0" />

      <div class="border-border/70 border-b bg-muted/45 px-3.5 pt-3 pb-2.5 backdrop-blur-xl">
        <p class="font-semibold text-[13px] text-popover-foreground tracking-tight">
          Selecting model
        </p>
        <p class="text-[10px] text-muted-foreground">Command Center</p>
      </div>

      <div class="border-border/70 border-b bg-background/45">
        <CommandInput
          aria-label="Search models"
          class="text-popover-foreground"
          onKeyDown={handleInputKeyDown}
          onValueChange={setQuery}
          placeholder="Search providers and models..."
          ref={registerSearchInput}
          value={query()}
        />
      </div>

      <CommandList
        aria-label="Model selector"
        class="scrollbar-default !max-h-none h-[420px] overflow-y-auto overflow-x-hidden bg-background/35 px-1.5 py-1.5"
      >
        <Show
          fallback={
            <CommandEmpty class="text-muted-foreground">
              No results found.
            </CommandEmpty>
          }
          when={modelEntries().length > 0}
        >
          <div
            class="scrollbar-emphasis h-[404px] overflow-y-auto"
            data-component="model-selector-virtual-list"
            onScroll={(event) =>
              setModelScrollTop(event.currentTarget.scrollTop)
            }
            ref={registerModelList}
          >
            <div
              class="relative w-full"
              style={{ height: `${modelRows().length * MODEL_ROW_HEIGHT}px` }}
            >
              <For each={visibleModelRows()}>
                {(entry) => (
                  <div
                    class="absolute right-0 left-0"
                    style={{
                      top: `${entry.absoluteIndex * MODEL_ROW_HEIGHT}px`,
                      height: `${MODEL_ROW_HEIGHT}px`,
                    }}
                  >
                    <Show
                      fallback={
                        <div class="px-1 py-0.5">
                          <CommandItem
                            aria-selected={
                              props.selectedModelId ===
                              (entry.row as ModelItemRow).model.id
                            }
                            class={cn(
                              "group relative h-9 rounded-md border border-transparent px-2.5 text-popover-foreground transition-all duration-200 hover:border-border/90 hover:bg-muted/70",
                              props.selectedModelId ===
                                (entry.row as ModelItemRow).model.id &&
                                "border-primary/35 bg-primary/10 text-primary",
                              isActive((entry.row as ModelItemRow).model.id) &&
                                "border-primary/45 bg-accent/70 shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-primary)_45%,transparent),0_8px_24px_color-mix(in_oklch,var(--color-primary)_18%,transparent)]"
                            )}
                            onPick={() => {
                              const row = entry.row as ModelItemRow;
                              handlePick(
                                row.model.id,
                                row.model.providerId,
                                row.model.reasoning
                              );
                            }}
                            value={(entry.row as ModelItemRow).model.id}
                          >
                            <span class="truncate">
                              {(entry.row as ModelItemRow).model.name}
                            </span>
                            {statusBadge(
                              (entry.row as ModelItemRow).model.status
                            )}
                          </CommandItem>
                        </div>
                      }
                      when={entry.row.kind === "heading"}
                    >
                      <div class="px-1 py-0.5">
                        <div class="flex items-center rounded-md border border-border/80 bg-muted/60 px-2 py-1 font-medium text-[11px] text-foreground">
                          <span class="truncate">
                            {(entry.row as ModelHeadingRow).providerName}
                          </span>
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </CommandList>

      <div class="flex items-center justify-end gap-2 border-border/80 border-t bg-muted/55 px-3 py-1.5 text-[10px] text-muted-foreground backdrop-blur-xl">
        <kbd class="rounded border border-border bg-background px-1.5 py-0.5 text-foreground">
          Enter
        </kbd>
        <span>Select</span>
        <kbd class="ml-2 rounded border border-border bg-background px-1.5 py-0.5 text-foreground">
          {"\u2191\u2193"}
        </kbd>
        <span>Navigate</span>
        <kbd class="ml-2 rounded border border-border bg-background px-1.5 py-0.5 text-foreground">
          Esc
        </kbd>
        <span>Close</span>
      </div>
    </CommandDialog>
  );
}
