import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import { useStore } from "~/stores/store-context";

export interface ModelSelectorOption {
  id: string;
  name: string;
  providerId: string;
  reasoning: boolean;
  status?: "active" | "alpha" | "beta" | "deprecated";
}

export interface ModelSelectorSection {
  models: ModelSelectorOption[];
  providerId: string;
  providerName: string;
}

export interface ModelHeadingRow {
  key: string;
  kind: "heading";
  providerName: string;
}

export interface ModelItemRow {
  key: string;
  kind: "model";
  model: ModelSelectorOption;
}

export type ModelRow = ModelHeadingRow | ModelItemRow;

export const MODEL_ROW_HEIGHT = 40;
const MODEL_OVERSCAN = 8;

export function useModelPicker() {
  const { api } = useStore();
  const [isOpen, setIsOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");

  const [selectorData] = createResource(async () => {
    const res = await api.api.models.connected.$get();
    if (!res.ok) {
      return [];
    }
    return (await res.json()) as Array<{
      providerId: string;
      providerName: string;
      models: Array<{
        id: string;
        name: string;
        status?: "active" | "alpha" | "beta" | "deprecated";
        reasoning: boolean;
      }>;
    }>;
  });

  const modelSections = createMemo(() => {
    const data = selectorData();
    if (!data) {
      return [];
    }
    const sections: ModelSelectorSection[] = data.map((section) => ({
      providerId: section.providerId,
      providerName: section.providerName,
      models: section.models.map((m) => ({
        id: m.id,
        name: m.name,
        providerId: section.providerId,
        reasoning: m.reasoning,
        ...(m.status === undefined ? {} : { status: m.status }),
      })),
    }));
    const query = searchQuery().trim().toLowerCase();
    if (!query) {
      return sections;
    }
    return sections
      .map((section) => ({
        ...section,
        models: section.models.filter((m) =>
          `${m.id} ${m.name} ${section.providerId}`
            .toLowerCase()
            .includes(query)
        ),
      }))
      .filter((section) => section.models.length > 0);
  });

  return {
    isOpen,
    setIsOpen,
    searchQuery,
    setSearchQuery,
    modelSections,
  };
}

export function useModelSelector(props: {
  modelSections: ModelSelectorSection[];
  open: boolean;
  searchQuery?: string;
  selectedModelId?: string;
  onSearchChange?: (query: string) => void;
  onSelect: (modelId: string, providerId: string, reasoning: boolean) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [modelScrollTop, setModelScrollTop] = createSignal(0);
  const [modelViewportHeight, setModelViewportHeight] = createSignal(404);
  let searchInputRef: HTMLInputElement | undefined;
  let modelListRef: HTMLDivElement | undefined;
  const registerSearchInput = (el: HTMLInputElement) => {
    searchInputRef = el;
  };
  const registerModelList = (el: HTMLDivElement) => {
    modelListRef = el;
  };

  const modelEntries = createMemo(() =>
    props.modelSections.flatMap((section) =>
      section.models.map((model) => ({
        id: model.id,
        providerId: model.providerId,
        title: model.name,
        subtitle: section.providerName,
        reasoning: model.reasoning,
      }))
    )
  );

  const modelRows = createMemo<ModelRow[]>(() => {
    const sections = props.modelSections;
    const rows: ModelRow[] = [];

    for (const section of sections) {
      rows.push({
        kind: "heading",
        key: `heading:${section.providerId}`,
        providerName: section.providerName,
      });

      for (const model of section.models) {
        rows.push({
          kind: "model",
          key: `model:${model.id}`,
          model,
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

  const handlePick = (
    modelId: string,
    providerId: string,
    reasoning: boolean
  ) => {
    props.onSelect(modelId, providerId, reasoning);
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
          handlePick(entry.id, entry.providerId, entry.reasoning);
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

  return {
    query,
    setQuery,
    activeIndex,
    modelScrollTop,
    setModelScrollTop,
    modelViewportHeight,
    registerSearchInput,
    registerModelList,
    modelEntries,
    modelRows,
    visibleModelRows,
    handlePick,
    handleInputKeyDown,
    isActive,
  };
}
