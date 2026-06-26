import { FileFinder } from "@ff-labs/fff-node";
import { spawnPiped } from "./spawn.ts";

export interface FileEntry {
  kind: "file" | "directory";
  path: string;
}

interface FffPicker {
  destroy(): void;
  isScanning(): boolean;
  mixedSearch(
    query: string,
    opts?: { pageSize?: number }
  ): {
    ok: boolean;
    value?: {
      items: Array<{
        type: "file" | "directory";
        item: { relativePath: string };
      }>;
      scores?: Array<{ total: number }>;
    };
    error?: string;
  };
  waitForScan(timeoutMs?: number): Promise<unknown>;
}

type PickerEntry = { ok: true; picker: FffPicker } | { ok: false };

/** Process-lifetime fff picker cache keyed by project cwd. */
const pickerCache = new Map<string, Promise<PickerEntry>>();

function getPicker(cwd: string): Promise<PickerEntry> {
  if (!FileFinder.isAvailable()) {
    return Promise.resolve({ ok: false });
  }
  const cached = pickerCache.get(cwd);
  if (cached) {
    return cached;
  }
  const created = FileFinder.create({ basePath: cwd, aiMode: true }) as {
    ok: boolean;
    value?: FffPicker;
    error?: string;
  };
  const entry = (async (): Promise<PickerEntry> => {
    if (!(created.ok && created.value)) {
      return { ok: false };
    }
    try {
      await created.value.waitForScan(10_000);
    } catch {
      // partial index is still usable; continue
    }
    return { ok: true, picker: created.value };
  })();
  pickerCache.set(cwd, entry);
  return entry;
}

/**
 * Search a project directory for files/directories matching `query`.
 *
 * Prefers the native fff frecency-ranked fuzzy finder (`@ff-labs/fff-node`),
 * falling back to `fd` then `find` when fff is unavailable or fails — mirroring
 * opencode's `locationLayer` dispatch. Results are relative paths.
 */
export async function searchProjectFiles(
  cwd: string,
  query: string | null,
  limit: number
): Promise<FileEntry[]> {
  const picker = await getPicker(cwd);
  if (picker.ok) {
    const found = picker.picker.mixedSearch(query ?? "", { pageSize: limit });
    if (found.ok && found.value) {
      const scored = found.value.items.map((item, index) => ({
        item,
        score: found.value?.scores?.[index]?.total ?? 0,
      }));
      scored.sort((a, b) => b.score - a.score || 0);
      return scored.slice(0, limit).map(({ item }) => ({
        path: item.item.relativePath,
        kind:
          item.type === "directory"
            ? ("directory" as const)
            : ("file" as const),
      }));
    }
  }

  const fdResults = await runFd(query, cwd, limit);
  if (fdResults.length > 0) {
    return fdResults;
  }
  return runFind(query, cwd, limit);
}

async function runFd(
  query: string | null,
  cwd: string,
  limit: number
): Promise<FileEntry[]> {
  try {
    const args: string[] = [
      "--type",
      "f",
      "--type",
      "d",
      "--max-results",
      String(limit),
      "--color",
      "never",
    ];
    if (query) {
      args.push(query);
    }
    const { done } = spawnPiped("fd", args, { cwd });
    const result = await done;
    if (result.spawnError) {
      return [];
    }
    const lines = result.stdout.split("\n").filter(Boolean).slice(0, limit);
    return lines.map((p) => ({
      path: p.endsWith("/") ? p.slice(0, -1) : p,
      kind: p.endsWith("/") ? ("directory" as const) : ("file" as const),
    }));
  } catch {
    return [];
  }
}

async function runFind(
  query: string | null,
  cwd: string,
  limit: number
): Promise<FileEntry[]> {
  try {
    const ignoreDirs = [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".cache",
      ".next",
      "__pycache__",
      ".DS_Store",
    ];
    const ignoreDirsExpr = ignoreDirs.flatMap((d) => [
      "-not",
      "-path",
      `*/${d}/*`,
    ]);

    const args: string[] = [".", "-type", "f"];
    if (query) {
      const escaped = query.replace(/[.*?[\]()]/g, "\\$&");
      args.push("-name", `*${escaped}*`);
    }
    args.push(...ignoreDirsExpr);

    const { done } = spawnPiped("find", args, { cwd });
    const result = await done;
    if (result.spawnError) {
      return [];
    }
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .slice(0, limit)
      .map((p) => ({ path: p, kind: "file" as const }));
  } catch {
    return [];
  }
}
