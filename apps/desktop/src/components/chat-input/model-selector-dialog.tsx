import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { cn } from "~/lib/utils";

export interface ModelSelectorOption {
  connected: boolean;
  id: string;
  name?: string;
  providerId: string;
  providerName?: string;
}

export interface ModelSelectorSection {
  connected: boolean;
  models: ModelSelectorOption[];
  providerId: string;
  providerName: string;
}

interface ModelHeadingRow {
  connected: boolean;
  key: string;
  kind: "heading";
  providerName: string;
}

interface ModelStatusHeadingRow {
  connected: boolean;
  key: string;
  kind: "status-heading";
  title: "Connected" | "Not Connected";
}

interface ModelItemRow {
  connected: boolean;
  key: string;
  kind: "model";
  model: ModelSelectorOption;
}

type ModelRow = ModelHeadingRow | ModelStatusHeadingRow | ModelItemRow;

export interface ModelSelectorDialogProps {
  modelSections: ModelSelectorSection[];
  onOpenChange: (open: boolean) => void;
  onSearchChange?: (query: string) => void;
  onSelect: (modelId: string) => void;
  open: boolean;
  searchQuery?: string;
  selectedModelId?: string;
}

const MODEL_ROW_HEIGHT = 40;
const MODEL_OVERSCAN = 8;

export function ModelSelectorDialog(props: ModelSelectorDialogProps) {
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [modelScrollTop, setModelScrollTop] = createSignal(0);
  const [modelViewportHeight, setModelViewportHeight] = createSignal(404);
  let searchInputRef: HTMLInputElement | undefined;
  let modelListRef: HTMLDivElement | undefined;

  const orderedModelSections = createMemo(() => {
    const connected = props.modelSections.filter((s) => s.connected);
    const notConnected = props.modelSections.filter((s) => !s.connected);
    return [...connected, ...notConnected];
  });

  const modelEntries = createMemo(() =>
    orderedModelSections().flatMap((section) =>
      section.models.map((model) => ({
        id: model.id,
        title: model.name ?? model.id,
        subtitle: section.providerName,
      }))
    )
  );

  const modelRows = createMemo<ModelRow[]>(() => {
    const sections = orderedModelSections();
    const rows: ModelRow[] = [];
    let previousConnected: boolean | null = null;

    for (const section of sections) {
      if (previousConnected !== section.connected) {
        rows.push({
          kind: "status-heading",
          key: `status:${section.connected ? "connected" : "not-connected"}`,
          title: section.connected ? "Connected" : "Not Connected",
          connected: section.connected,
        });
        previousConnected = section.connected;
      }

      rows.push({
        kind: "heading",
        key: `heading:${section.providerId}`,
        providerName: section.providerName,
        connected: section.connected,
      });

      for (const model of section.models) {
        rows.push({
          kind: "model",
          key: `model:${model.id}`,
          model,
          connected: section.connected,
        });
      }
    }

    return rows;
  });

  const visibleModelRows = createMemo(() => {
    const rows = modelRows();
    const start = Math.max(
      0,
      Math.floor(modelScrollTop() / MODEL_ROW_HEIGHT) - MODEL_OVERSCAN
    );
    const end = Math.min(
      rows.length,
      Math.ceil((modelScrollTop() + modelViewportHeight()) / MODEL_ROW_HEIGHT) +
        MODEL_OVERSCAN
    );
    return rows.slice(start, end).map((row, localIndex) => ({
      row,
      absoluteIndex: start + localIndex,
    }));
  });

  const modelRowIndexById = createMemo(() => {
    const map = new Map<string, number>();
    modelRows().forEach((row, index) => {
      if (row.kind === "model") {
        map.set(row.model.id, index);
      }
    });
    return map;
  });

  // Sync external search query
  createEffect(() => {
    if (props.searchQuery === undefined) {
      return;
    }
    if (props.searchQuery !== query()) {
      setQuery(props.searchQuery);
    }
  });

  // Notify parent of search changes
  createEffect(() => {
    props.onSearchChange?.(query());
  });

  // Reset active index on open / model change
  createEffect(() => {
    if (!props.open) {
      return;
    }
    const ids = modelEntries().map((e) => e.id);
    if (ids.length === 0) {
      setActiveIndex(0);
      return;
    }
    const selectedIndex = props.selectedModelId
      ? ids.indexOf(props.selectedModelId)
      : -1;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  });

  // Reset scroll on open
  createEffect(() => {
    if (!props.open) {
      return;
    }
    setModelScrollTop(0);
  });

  // Measure viewport height
  createEffect(() => {
    if (!props.open) {
      return;
    }
    const height = modelListRef?.clientHeight ?? 404;
    if (height > 0) {
      setModelViewportHeight(height);
    }
  });

  // Focus search input on open
  createEffect(() => {
    if (!props.open) {
      return;
    }
    const timer = setTimeout(() => {
      searchInputRef?.focus();
      searchInputRef?.select();
    }, 50);
    requestAnimationFrame(() => {
      searchInputRef?.focus();
      searchInputRef?.select();
    });
    onCleanup(() => clearTimeout(timer));
  });

  // Scroll active item into view
  createEffect(() => {
    if (!(props.open && modelListRef)) {
      return;
    }
    const activeId = modelEntries()[activeIndex()]?.id;
    if (!activeId) {
      return;
    }

    const rowIndex = modelRowIndexById().get(activeId);
    if (rowIndex === undefined) {
      return;
    }

    const rowTop = rowIndex * MODEL_ROW_HEIGHT;
    const rowBottom = rowTop + MODEL_ROW_HEIGHT;
    const viewTop = modelListRef.scrollTop;
    const viewportHeight = modelListRef.clientHeight || modelViewportHeight();
    const viewBottom = viewTop + viewportHeight;

    if (rowTop < viewTop) {
      modelListRef.scrollTop = rowTop;
      setModelScrollTop(rowTop);
    } else if (rowBottom > viewBottom) {
      const nextTop = rowBottom - viewportHeight;
      modelListRef.scrollTop = nextTop;
      setModelScrollTop(nextTop);
    }
  });

  const handlePick = (modelId: string) => {
    props.onSelect(modelId);
    setQuery("");
    props.onOpenChange(false);
  };

  const handleInputKeyDown = (event: KeyboardEvent) => {
    const ids = modelEntries();
    if (ids.length === 0) {
      return;
    }

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % ids.length);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + ids.length) % ids.length);
        break;
      }
      case "Enter": {
        event.preventDefault();
        const entry = ids[activeIndex()];
        if (entry) {
          handlePick(entry.id);
        }
        break;
      }
      case "Escape": {
        event.preventDefault();
        props.onOpenChange(false);
        break;
      }
    }
  };

  const isActive = (id: string) => modelEntries()[activeIndex()]?.id === id;

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
          ref={(el: HTMLInputElement) => {
            searchInputRef = el;
          }}
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
            ref={(el: HTMLDivElement) => {
              modelListRef = el;
            }}
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
                            onPick={handlePick}
                            value={(entry.row as ModelItemRow).model.id}
                          >
                            <span class="truncate">
                              {(entry.row as ModelItemRow).model.name ??
                                (entry.row as ModelItemRow).model.id}
                            </span>
                          </CommandItem>
                        </div>
                      }
                      when={entry.row.kind !== "model"}
                    >
                      <div class="px-1 py-0.5">
                        <Show
                          fallback={
                            <div class="flex items-center justify-between rounded-md border border-border/80 bg-muted/60 px-2 py-1 font-medium text-[11px] text-foreground">
                              <span class="truncate">
                                {(entry.row as ModelHeadingRow).providerName}
                              </span>
                              <span
                                class={cn(
                                  "ml-2 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                                  (entry.row as ModelHeadingRow).connected
                                    ? "border-primary/30 bg-primary/10 text-primary"
                                    : "border-border bg-background text-muted-foreground"
                                )}
                              >
                                {(entry.row as ModelHeadingRow).connected
                                  ? "Connected"
                                  : "Not Connected"}
                              </span>
                            </div>
                          }
                          when={entry.row.kind === "status-heading"}
                        >
                          <p class="px-1 py-1 font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.1em]">
                            {(entry.row as ModelStatusHeadingRow).title}
                          </p>
                        </Show>
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
