export type ContextMenuMode = "/" | "@";

export interface CatalogItem {
  description?: string;
  name: string;
}

export interface FileItem {
  kind: "file" | "directory";
  path: string;
}

export interface Row {
  description?: string;
  group: string;
  id: string;
  label: string;
  token: string;
}

function matches(haystack: string, query: string): boolean {
  if (!query) {
    return true;
  }
  return haystack.toLowerCase().includes(query.toLowerCase());
}

/**
 * Build the flat, ordered list of rows shown in the inline context menu. The
 * same array drives keyboard nav (useListNavigation) and rendering, so arrow
 * order always matches visual order. `/` filters commands+skills client-side;
 * `@` expects server-filtered files and adds a "use as path" fallback when the
 * search comes up empty for a non-empty query.
 */
export function buildRows(opts: {
  mode: ContextMenuMode;
  query: string;
  commands: CatalogItem[];
  skills: CatalogItem[];
  files: FileItem[];
}): Row[] {
  const { mode, query, commands, skills, files } = opts;
  const q = query.trim();

  if (mode === "/") {
    const commandRows: Row[] = commands
      .filter((c) => matches(`${c.name} ${c.description ?? ""}`, q))
      .map((c) => ({
        group: "Commands",
        id: `cmd:${c.name}`,
        label: c.name,
        token: `/${c.name}`,
        ...(c.description !== undefined ? { description: c.description } : {}),
      }));
    const skillRows: Row[] = skills
      .filter((s) => matches(`${s.name} ${s.description ?? ""}`, q))
      .map((s) => ({
        group: "Skills",
        id: `skl:${s.name}`,
        label: s.name,
        token: `skill:${s.name}`,
        ...(s.description !== undefined ? { description: s.description } : {}),
      }));
    return [...commandRows, ...skillRows];
  }

  const fileRows: Row[] = files.map((f) => ({
    group: "Files",
    id: `${f.kind === "directory" ? "dir" : "file"}:${f.path}`,
    label: f.path,
    token: `@${f.path}`,
  }));

  if (fileRows.length > 0 || q.length === 0) {
    return fileRows;
  }

  return [
    {
      group: "Files",
      id: "use-as-path",
      label: `Use '@${q}' as a path`,
      token: `@${q}`,
    },
    ...fileRows,
  ];
}
