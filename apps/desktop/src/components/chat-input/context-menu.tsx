import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import {
  CommandDialog,
  CommandDialogHeader,
  CommandDialogTitle,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { useListNavigation } from "./use-list-navigation.ts";

export type ContextMenuMode = "/" | "@";

export interface CatalogItem {
  description?: string;
  name: string;
}

export interface FileItem {
  path: string;
}

export interface ContextMenuProps {
  commands: CatalogItem[];
  files: FileItem[];
  mode: ContextMenuMode;
  onClose: () => void;
  /** @ mode: parent debounces this and refetches files. */
  onFilesQuery?: (query: string) => void;
  onPick: (token: string) => void;
  open: boolean;
  skills: CatalogItem[];
}

interface Row {
  id: string;
  label: string;
  token: string;
}

/**
 * Mode-aware command palette built on `CommandDialog`. Presentational — the
 * parent owns fetching (catalog via GET /projects/:id/context, files via
 * /files) and passes data in as props, mirroring ModelSelectorDialog. `/` mode
 * filters commands+skills client-side; `@` mode delegates filtering to the
 * server (onFilesQuery) and offers an "insert as path anyway" row when the
 * search comes up empty.
 */
export function ContextMenu(props: ContextMenuProps): JSX.Element {
  const [query, setQuery] = createSignal("");

  const commandRows = createMemo<Row[]>(() => {
    const q = query().trim().toLowerCase();
    return props.commands
      .filter((c) => (q ? `${c.name} ${c.description ?? ""}`.toLowerCase().includes(q) : true))
      .map((c) => ({
        id: `cmd:${c.name}`,
        label: c.name,
        token: `/${c.name}`,
      }));
  });

  const skillRows = createMemo<Row[]>(() => {
    const q = query().trim().toLowerCase();
    return props.skills
      .filter((s) => (q ? `${s.name} ${s.description ?? ""}`.toLowerCase().includes(q) : true))
      .map((s) => ({
        id: `skl:${s.name}`,
        label: s.name,
        token: `skill:${s.name}`,
      }));
  });

  const fileRows = createMemo<Row[]>(() =>
    props.files.map((f) => ({
      id: `file:${f.path}`,
      label: f.path,
      token: `@${f.path}`,
    })),
  );

  // @ mode: when the server search returns nothing and the user has typed a
  // query, offer to insert it as a path verbatim (safe — the server leaves
  // non-file @tokens untouched).
  const useAsPathRow = createMemo<Row | null>(() => {
    if (props.mode !== "@" || props.files.length > 0) {
      return null;
    }
    const q = query().trim();
    if (q.length === 0) {
      return null;
    }
    return {
      id: "use-as-path",
      label: `Use '@${q}' as a path`,
      token: `@${q}`,
    };
  });

  const rows = createMemo<Row[]>(() => {
    if (props.mode === "/") {
      return [...commandRows(), ...skillRows()];
    }
    const useRow = useAsPathRow();
    return useRow ? [useRow, ...fileRows()] : fileRows();
  });

  const pick = (token: string) => {
    props.onPick(token);
    props.onClose();
  };

  const nav = useListNavigation<Row>(rows, {
    onPick: (row) => pick(row.token),
    onClose: () => props.onClose(),
  });

  const onQueryChange = (v: string) => {
    setQuery(v);
    if (props.mode === "@") {
      props.onFilesQuery?.(v);
    }
  };

  return (
    <CommandDialog
      onOpenChange={(o) => {
        if (!o) {
          props.onClose();
        }
      }}
      open={props.open}
    >
      <CommandDialogHeader>
        <CommandDialogTitle>
          {props.mode === "/" ? "Commands & Skills" : "Files"}
        </CommandDialogTitle>
      </CommandDialogHeader>
      <CommandInput
        onKeyDown={nav.handleKeyDown}
        onValueChange={onQueryChange}
        placeholder={props.mode === "/" ? "Filter…" : "Search files…"}
        value={query()}
      />
      <CommandList>
        <Show fallback={<CommandEmpty>No matches</CommandEmpty>} when={rows().length > 0}>
          <Show when={props.mode === "/"}>
            <CommandGroup heading="Commands">
              <For each={commandRows()}>
                {(r) => (
                  <CommandItem
                    aria-selected={nav.isActive(r.id)}
                    onPick={() => pick(r.token)}
                    value={r.id}
                  >
                    {r.label}
                  </CommandItem>
                )}
              </For>
            </CommandGroup>
            <Show when={skillRows().length > 0}>
              <CommandGroup heading="Skills">
                <For each={skillRows()}>
                  {(r) => (
                    <CommandItem
                      aria-selected={nav.isActive(r.id)}
                      onPick={() => pick(r.token)}
                      value={r.id}
                    >
                      {r.label}
                    </CommandItem>
                  )}
                </For>
              </CommandGroup>
            </Show>
          </Show>
          <Show when={props.mode === "@"}>
            <CommandGroup heading="Files">
              <For each={rows()}>
                {(r) => (
                  <CommandItem
                    aria-selected={nav.isActive(r.id)}
                    onPick={() => pick(r.token)}
                    value={r.id}
                  >
                    {r.label}
                  </CommandItem>
                )}
              </For>
            </CommandGroup>
          </Show>
        </Show>
      </CommandList>
    </CommandDialog>
  );
}
