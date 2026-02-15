import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/utils";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

export type CommandCenterMode = "model" | "mcp" | "skills" | "context";

export interface ModelSelectorOption {
  id: string;
  providerId: string;
  providerName?: string;
  name?: string;
  connected: boolean;
}

export interface ModelSelectorSection {
  providerId: string;
  providerName: string;
  connected: boolean;
  models: ModelSelectorOption[];
}

interface ModelSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModelId?: string;
  mode: CommandCenterMode;
  onModeChange: (mode: CommandCenterMode) => void;
  modelSections: ModelSelectorSection[];
  onSearchChange: (query: string) => void;
  onSelect: (modelId: string) => void;
}

interface CommandEntry {
  id: string;
  label: string;
  description: string;
}

interface ModelHeadingRow {
  kind: "heading";
  key: string;
  providerName: string;
  connected: boolean;
}

interface ModelItemRow {
  kind: "model";
  key: string;
  model: ModelSelectorOption;
  connected: boolean;
}

type ModelRow = ModelHeadingRow | ModelItemRow;

const SKILL_ENTRIES: CommandEntry[] = [
  {
    id: "skill:brainstorming",
    label: "Brainstorming",
    description: "Explore intent before implementation",
  },
  { id: "skill:tdd", label: "Test-Driven Development", description: "Write failing tests first" },
  {
    id: "skill:debug",
    label: "Systematic Debugging",
    description: "Root-cause-first debugging flow",
  },
];

const MCP_ENTRIES: CommandEntry[] = [
  { id: "mcp:status", label: "MCP Servers", description: "List connected MCP servers" },
  { id: "mcp:refresh", label: "Refresh MCP Status", description: "Re-check MCP availability" },
];

const CONTEXT_ENTRIES: CommandEntry[] = [
  {
    id: "context:file",
    label: "Add File Context",
    description: "Attach file contents to prompt context",
  },
  {
    id: "context:symbol",
    label: "Add Symbol Context",
    description: "Attach selected symbol details",
  },
];

const MODE_PILLS: Array<{ mode: CommandCenterMode; label: string }> = [
  { mode: "model", label: "/model" },
  { mode: "mcp", label: "/mcp" },
  { mode: "skills", label: "/skills" },
  { mode: "context", label: "@context" },
];

export function ModelSelector(props: ModelSelectorProps) {
  const DEBUG_PREFIX = "[model-selector-debug]";
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [modelScrollTop, setModelScrollTop] = createSignal(0);
  const [modelViewportHeight, setModelViewportHeight] = createSignal(404);
  let searchInputRef: HTMLInputElement | undefined;
  let modelListRef: HTMLDivElement | undefined;

  const MODEL_ROW_HEIGHT = 40;
  const MODEL_VIEWPORT_FALLBACK_HEIGHT = 404;
  const MODEL_OVERSCAN = 8;

  createEffect(() => {
    props.onSearchChange(query());
  });

  const modelEntries = createMemo(() =>
    props.modelSections.flatMap(section =>
      section.models.map(model => ({
        id: model.id,
        title: model.name ?? model.id,
        subtitle: section.providerName,
      }))
    )
  );
  const modelRows = createMemo<ModelRow[]>(() =>
    props.modelSections.flatMap(section => [
      {
        kind: "heading" as const,
        key: `heading:${section.providerId}`,
        providerName: section.providerName,
        connected: section.connected,
      },
      ...section.models.map(model => ({
        kind: "model" as const,
        key: `model:${model.id}`,
        model,
        connected: section.connected,
      })),
    ])
  );
  const visibleModelRows = createMemo(() => {
    const rows = modelRows();
    const start = Math.max(0, Math.floor(modelScrollTop() / MODEL_ROW_HEIGHT) - MODEL_OVERSCAN);
    const end = Math.min(
      rows.length,
      Math.ceil((modelScrollTop() + modelViewportHeight()) / MODEL_ROW_HEIGHT) + MODEL_OVERSCAN
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

  const commandEntries = createMemo(() => {
    switch (props.mode) {
      case "mcp":
        return MCP_ENTRIES;
      case "skills":
        return SKILL_ENTRIES;
      case "context":
        return CONTEXT_ENTRIES;
      default:
        return [];
    }
  });

  const visibleEntryIds = createMemo(() =>
    props.mode === "model"
      ? modelEntries().map(entry => entry.id)
      : commandEntries().map(entry => entry.id)
  );

  createEffect(() => {
    if (!props.open) return;
    const ids = visibleEntryIds();
    if (ids.length === 0) {
      setActiveIndex(0);
      return;
    }
    if (props.mode === "model") {
      const selectedIndex = ids.findIndex(id => id === props.selectedModelId);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
      return;
    }
    setActiveIndex(0);
  });
  createEffect(() => {
    if (!props.open || props.mode !== "model") return;
    setModelScrollTop(0);
  });
  createEffect(() => {
    if (!props.open || props.mode !== "model") return;
    const height = modelListRef?.clientHeight ?? MODEL_VIEWPORT_FALLBACK_HEIGHT;
    if (height > 0) setModelViewportHeight(height);
  });
  createEffect(() => {
    if (!props.open) return;
    queueMicrotask(() => searchInputRef?.focus());
  });
  createEffect(() => {
    if (!props.open || props.mode !== "model") return;
    const activeId = visibleEntryIds()[activeIndex()];
    if (!activeId || !modelListRef) return;

    const rowIndex = modelRowIndexById().get(activeId);
    if (rowIndex === undefined) return;

    const rowTop = rowIndex * MODEL_ROW_HEIGHT;
    const rowBottom = rowTop + MODEL_ROW_HEIGHT;
    const viewTop = modelListRef.scrollTop;
    const viewportHeight = modelListRef.clientHeight || modelViewportHeight();
    const viewBottom = viewTop + viewportHeight;

    if (rowTop < viewTop) {
      modelListRef.scrollTop = rowTop;
      setModelScrollTop(rowTop);
      return;
    }
    if (rowBottom > viewBottom) {
      const nextTop = rowBottom - viewportHeight;
      modelListRef.scrollTop = nextTop;
      setModelScrollTop(nextTop);
    }
  });

  const handlePick = (modelId: string) => {
    if (props.mode !== "model") return;
    console.log(`${DEBUG_PREFIX} model-selector:pick`, {
      modelId,
      selectedModelId: props.selectedModelId,
    });
    props.onSelect(modelId);
    setQuery("");
    props.onOpenChange(false);
  };

  const handleCommandPick = () => {
    props.onOpenChange(false);
    setQuery("");
  };

  const handleInputKeyDown = (event: KeyboardEvent) => {
    const ids = visibleEntryIds();
    if (ids.length === 0) return;

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        setActiveIndex(index => (index + 1) % ids.length);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        setActiveIndex(index => (index - 1 + ids.length) % ids.length);
        break;
      }
      case "Enter": {
        event.preventDefault();
        const id = ids[activeIndex()];
        if (!id) return;
        if (props.mode === "model") {
          handlePick(id);
          return;
        }
        handleCommandPick();
        break;
      }
      case "Escape": {
        event.preventDefault();
        props.onOpenChange(false);
        break;
      }
      default:
        break;
    }
  };

  const isActive = (id: string) => visibleEntryIds()[activeIndex()] === id;

  return (
    <CommandDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      contentClass="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/95 p-0 shadow-[0_22px_80px_rgba(0,0,0,0.58)]"
    >
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_15%_-10%,rgba(56,189,248,0.1),transparent_52%),radial-gradient(70%_100%_at_95%_0%,rgba(16,185,129,0.08),transparent_45%)]" />
      <div class="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_36%)]" />
      <div class="border-b border-zinc-800/90 bg-zinc-900/75 px-3.5 pb-2.5 pt-3 backdrop-blur-xl">
        <div class="mb-1.5 flex items-center justify-between">
          <div>
            <p class="text-[13px] font-semibold tracking-tight text-zinc-100">Selecting model</p>
            <p class="text-[10px] text-zinc-500">Command Center</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <For each={MODE_PILLS}>
            {pill => (
              <button
                type="button"
                onClick={() => props.onModeChange(pill.mode)}
                class={cn(
                  "rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-all duration-150",
                  props.mode === pill.mode
                    ? "border-sky-400/25 bg-sky-400/10 text-sky-200 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.12)]"
                    : "border-zinc-700/60 bg-zinc-800/65 text-zinc-400 hover:border-zinc-500/70 hover:text-zinc-200"
                )}
              >
                {pill.label}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="border-b border-zinc-800/90 bg-zinc-900/55">
        <CommandInput
          ref={searchInputRef}
          aria-label="Search models"
          value={query()}
          onValueChange={setQuery}
          onKeyDown={handleInputKeyDown}
          placeholder={
            props.mode === "model"
              ? "Search providers and models..."
              : props.mode === "mcp"
                ? "Search MCP commands..."
                : props.mode === "skills"
                  ? "Search skills..."
                  : "Search context commands..."
          }
          class="text-zinc-100"
        />
      </div>

      <CommandList
        aria-label="Model selector"
        class="h-[420px] !max-h-none overflow-hidden bg-zinc-950/35 px-1.5 py-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700/60 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-600/80 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2"
      >
        <Show
          when={props.mode === "model" ? modelEntries().length > 0 : commandEntries().length > 0}
          fallback={<CommandEmpty class="text-zinc-500">No results found.</CommandEmpty>}
        >
          <Show when={props.mode === "model"}>
            <div
              ref={modelListRef}
              class="h-[404px] overflow-y-auto [scrollbar-color:rgba(82,82,91,0.7)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700/60 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-600/80 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2"
              data-component="model-selector-virtual-list"
              onScroll={event => setModelScrollTop(event.currentTarget.scrollTop)}
            >
              <div
                class="relative w-full"
                style={{ height: `${modelRows().length * MODEL_ROW_HEIGHT}px` }}
              >
                <For each={visibleModelRows()}>
                  {entry => (
                    <div
                      class="absolute left-0 right-0"
                      style={{
                        top: `${entry.absoluteIndex * MODEL_ROW_HEIGHT}px`,
                        height: `${MODEL_ROW_HEIGHT}px`,
                      }}
                    >
                      <Show
                        when={entry.row.kind === "heading"}
                        fallback={
                          <div class="px-1 py-0.5">
                            <CommandItem
                              value={(entry.row as ModelItemRow).model.id}
                              aria-selected={
                                props.selectedModelId === (entry.row as ModelItemRow).model.id
                              }
                              class={cn(
                                "group relative h-9 rounded-md border border-transparent px-2.5 text-zinc-100 transition-all duration-150 hover:border-zinc-700/50 hover:bg-zinc-800/80",
                                props.selectedModelId === (entry.row as ModelItemRow).model.id &&
                                  "bg-sky-500/8 border-sky-400/20 text-sky-100",
                                isActive((entry.row as ModelItemRow).model.id) &&
                                  "border-zinc-600/60 bg-zinc-800/85 shadow-[0_0_0_1px_rgba(56,189,248,0.14),0_4px_16px_rgba(56,189,248,0.12)]"
                              )}
                              onPick={handlePick}
                            >
                              <span class="truncate">
                                {(entry.row as ModelItemRow).model.name ??
                                  (entry.row as ModelItemRow).model.id}
                              </span>
                            </CommandItem>
                          </div>
                        }
                      >
                        <div class="px-1 py-0.5">
                          <div class="flex items-center justify-between rounded-md border border-zinc-800/70 bg-zinc-900/75 px-2 py-1 text-[11px] font-medium text-zinc-300">
                            <span class="truncate">
                              {(entry.row as ModelHeadingRow).providerName}
                            </span>
                            <span
                              class={cn(
                                "ml-2 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                                (entry.row as ModelHeadingRow).connected
                                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                                  : "border-zinc-600 bg-zinc-800 text-zinc-400"
                              )}
                            >
                              {(entry.row as ModelHeadingRow).connected
                                ? "Connected"
                                : "Not Connected"}
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
          <Show when={props.mode !== "model"}>
            <CommandGroup
              heading={
                props.mode === "mcp" ? "MCP" : props.mode === "skills" ? "Skills" : "Context"
              }
              class="[&_[cmdk-group-heading]]:rounded-md [&_[cmdk-group-heading]]:border [&_[cmdk-group-heading]]:border-zinc-800/70 [&_[cmdk-group-heading]]:bg-zinc-900/75 [&_[cmdk-group-heading]]:text-zinc-300"
            >
              <For each={commandEntries()}>
                {entry => (
                  <CommandItem
                    value={entry.id}
                    class={cn(
                      "h-9 rounded-md border border-transparent px-2.5 text-zinc-100 transition-all duration-150 hover:border-zinc-700/50 hover:bg-zinc-800/80",
                      isActive(entry.id) &&
                        "border-zinc-600/60 bg-zinc-800/85 shadow-[0_0_0_1px_rgba(56,189,248,0.14),0_4px_16px_rgba(56,189,248,0.12)]"
                    )}
                    onPick={handleCommandPick}
                  >
                    <span class="truncate">{entry.label}</span>
                    <span class="ml-auto text-[11px] text-zinc-500">{entry.description}</span>
                  </CommandItem>
                )}
              </For>
            </CommandGroup>
          </Show>
        </Show>
      </CommandList>

      <div class="flex items-center justify-end gap-2 border-t border-zinc-800/80 bg-zinc-900/80 px-3 py-1.5 text-[10px] text-zinc-400 backdrop-blur-xl">
        <kbd class="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
          Enter
        </kbd>
        <span>Select</span>
        <kbd class="ml-2 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
          ↑↓
        </kbd>
        <span>Navigate</span>
        <kbd class="ml-2 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
          Esc
        </kbd>
        <span>Close</span>
      </div>
    </CommandDialog>
  );
}
