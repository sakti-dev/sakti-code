import { FileFinder } from "@ff-labs/fff-node";
import { spawnPiped } from "./spawn.ts";

export interface FileEntry {
  kind: "file" | "directory";
  path: string;
}

interface FffPicker {
  destroy(): void;
  directorySearch(
    query: string,
    opts?: { pageSize?: number },
  ): {
    ok: boolean;
    value?: {
      items: Array<{ relativePath: string }>;
      scores?: FffScore[];
    };
    error?: string;
  };
  isScanning(): boolean;
  mixedSearch(
    query: string,
    opts?: { pageSize?: number },
  ): {
    ok: boolean;
    value?: {
      items: Array<{
        type: "file" | "directory";
        item: { relativePath: string };
      }>;
      scores?: FffScore[];
    };
    error?: string;
  };
  waitForScan(timeoutMs?: number): Promise<unknown>;
}

type PickerEntry = { ok: true; picker: FffPicker } | { ok: false };
type FffScore = {
  exactMatch?: boolean;
  filenameBonus?: number;
  matchType?: string;
  total: number;
};
type RankedEntry = FileEntry & { index: number; score: number };

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

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/$/, "").replace(/^\.\//, "");
}

function normalizeQuery(query: string | null): string {
  return normalizeRelativePath((query ?? "").trim());
}

function isDirectoryIntent(query: string | null): boolean {
  const trimmed = (query ?? "").trim();
  return trimmed.endsWith("/") || trimmed.endsWith("\\");
}

function isFilenameLikeQuery(query: string | null): boolean {
  const normalizedQuery = normalizeQuery(query);
  return normalizedQuery.includes(".") && !isDirectoryIntent(query);
}

function pathSegments(path: string): string[] {
  return normalizeRelativePath(path)
    .toLowerCase()
    .split("/")
    .filter((segment) => segment.length > 0);
}

function basename(path: string): string {
  const segments = pathSegments(path);
  return segments.at(-1) ?? "";
}

function isConfidentFffMatch(entry: FileEntry, score: FffScore | undefined, query: string | null) {
  const normalizedQuery = normalizeQuery(query).toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const normalizedPath = normalizeRelativePath(entry.path).toLowerCase();
  const entryBase = basename(entry.path);
  const queryBase = basename(normalizedQuery);

  if (isFilenameLikeQuery(query)) {
    return normalizedPath.includes(normalizedQuery) || entryBase.includes(queryBase);
  }

  if (
    normalizedPath.includes(normalizedQuery) ||
    entryBase.includes(queryBase) ||
    score?.exactMatch === true ||
    (score?.filenameBonus ?? 0) > 0
  ) {
    return true;
  }

  const matchType = score?.matchType ?? "";
  if (
    (matchType === "fuzzy_filename" || matchType === "fuzzy_dirname") &&
    (score?.total ?? 0) >= 100
  ) {
    return true;
  }

  return false;
}

function directoryBoost(entry: FileEntry, query: string | null): number {
  const normalizedQuery = normalizeQuery(query).toLowerCase();
  if (!normalizedQuery) {
    return entry.kind === "directory" ? 50 : 0;
  }

  const normalizedPath = normalizeRelativePath(entry.path).toLowerCase();
  const entryBase = basename(entry.path);
  const queryBase = basename(normalizedQuery);
  const filenameLike = isFilenameLikeQuery(query);

  if (filenameLike) {
    if (entry.kind === "file" && entryBase.includes(queryBase)) {
      return 1_100;
    }
    return 0;
  }

  if (entry.kind === "file" && entryBase === queryBase) {
    return 950;
  }
  if (
    entry.kind === "file" &&
    normalizedPath.includes(`/${normalizedQuery}/`) &&
    entryBase.startsWith(queryBase)
  ) {
    return 980;
  }
  if (entry.kind === "file" && normalizedPath.includes(`/${normalizedQuery}/`)) {
    return 960;
  }
  if (entry.kind === "file" && entryBase.startsWith(queryBase)) {
    return 940;
  }
  if (entry.kind === "file" && entryBase.includes(queryBase)) {
    return 900;
  }
  if (entry.kind === "file" && normalizedPath.includes(normalizedQuery)) {
    return 700;
  }

  if (entry.kind === "directory" && normalizedPath === normalizedQuery) {
    return 1_200;
  }
  if (entry.kind === "directory" && normalizedPath.endsWith(`/${normalizedQuery}`)) {
    return 1_150;
  }
  if (entry.kind === "directory" && entryBase === queryBase) {
    return 1_100;
  }
  if (
    entry.kind === "directory" &&
    (normalizedPath.includes(`/${normalizedQuery}/`) ||
      normalizedPath.endsWith(`/${normalizedQuery}`))
  ) {
    return 500;
  }
  if (
    entry.kind === "directory" &&
    pathSegments(entry.path).some((part) => part.startsWith(queryBase))
  ) {
    return 300;
  }
  return 0;
}

function rankEntries(entries: RankedEntry[], query: string | null, limit: number): FileEntry[] {
  const directoryOnly = isDirectoryIntent(query);
  const filesOnly = isFilenameLikeQuery(query);
  const seen = new Set<string>();
  return entries
    .filter((entry) => !directoryOnly || entry.kind === "directory")
    .filter((entry) => !filesOnly || entry.kind === "file")
    .map((entry) => ({
      ...entry,
      contextBoost: directoryBoost(entry, query),
      depth: normalizeRelativePath(entry.path).split("/").length,
    }))
    .sort((a, b) => {
      const boostDelta = b.contextBoost - a.contextBoost;
      if (boostDelta !== 0) {
        return boostDelta;
      }
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      const depthDelta = a.depth - b.depth;
      if (depthDelta !== 0) {
        return depthDelta;
      }
      return a.index - b.index;
    })
    .filter((entry) => {
      const key = `${entry.kind}:${entry.path}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ kind, path }) => ({ kind, path }));
}

/**
 * fff's native index omits intermediate directories that contain no files
 * directly (e.g. `src` when only `src/features/index.ts` exists). For context
 * search, directories are first-class results, so synthesize missing ancestor
 * directories from the returned paths before ranking.
 */
function withAncestorDirectories(entries: RankedEntry[], query: string | null): RankedEntry[] {
  const existing = new Set(entries.map((e) => `${e.kind}:${e.path}`));
  const result = [...entries];
  const shouldAddAnyAncestor = normalizeQuery(query).length === 0;
  let nextIndex = entries.length;
  for (const entry of entries) {
    const segments = normalizeRelativePath(entry.path).split("/");
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i).join("/");
      const ancestorEntry = { path: ancestor, kind: "directory" as const };
      if (!shouldAddAnyAncestor && directoryBoost(ancestorEntry, query) === 0) {
        continue;
      }
      const key = `directory:${ancestor}`;
      if (!existing.has(key)) {
        existing.add(key);
        result.push({ ...ancestorEntry, score: 0, index: nextIndex++ });
      }
    }
  }
  return result;
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
  limit: number,
): Promise<FileEntry[]> {
  const picker = await getPicker(cwd);
  if (picker.ok) {
    const pageSize = Math.max(limit * 4, limit);
    const found = isDirectoryIntent(query)
      ? picker.picker.directorySearch(query ?? "", { pageSize })
      : picker.picker.mixedSearch(query ?? "", { pageSize });
    if (found.ok && found.value) {
      const mapped = found.value.items
        .map((item, index) => {
          const score = found.value?.scores?.[index];
          if ("type" in item) {
            return {
              path: normalizeRelativePath(item.item.relativePath),
              kind: item.type === "directory" ? ("directory" as const) : ("file" as const),
              fffScore: score,
              score: score?.total ?? 0,
              index,
            };
          }
          return {
            path: normalizeRelativePath(item.relativePath),
            kind: "directory" as const,
            fffScore: score,
            score: score?.total ?? 0,
            index,
          };
        })
        .filter((entry) => isConfidentFffMatch(entry, entry.fffScore, query));
      // Directory-intent queries return only matching directories; for general
      // queries, surface missing ancestor directories so directories stay
      // first-class results even when fff's index omits intermediates.
      const entries =
        isDirectoryIntent(query) || isFilenameLikeQuery(query)
          ? mapped
          : withAncestorDirectories(mapped, query);
      const ranked = rankEntries(entries, query, limit);
      if (isFilenameLikeQuery(query) && ranked.every((entry) => entry.kind === "directory")) {
        const fdResults = await runFd(query, cwd, limit);
        if (fdResults.length > 0) {
          return fdResults;
        }
      }
      if (ranked.length > 0 || isDirectoryIntent(query)) {
        return ranked;
      }
    }
  }

  const fdResults = await runFd(query, cwd, limit);
  if (fdResults.length > 0) {
    return fdResults;
  }
  return runFind(query, cwd, limit);
}

async function runFd(query: string | null, cwd: string, limit: number): Promise<FileEntry[]> {
  try {
    const directoryOnly = isDirectoryIntent(query);
    const searchQuery = normalizeQuery(query);

    const runTypedFd = async (
      type: "f" | "d",
      kind: "file" | "directory",
      startIndex: number,
    ): Promise<Array<FileEntry & { score: number; index: number }> | null> => {
      const args = [
        "--type",
        type,
        "--max-results",
        String(Math.max(limit * 4, limit)),
        "--color",
        "never",
      ];
      if (searchQuery) {
        args.push(searchQuery);
      }
      const { done } = spawnPiped("fd", args, { cwd });
      const result = await done;
      if (result.spawnError) {
        return null;
      }
      return result.stdout
        .split("\n")
        .filter(Boolean)
        .map((p, offset) => ({
          path: normalizeRelativePath(p),
          kind,
          score: 0,
          index: startIndex + offset,
        }));
    };

    const directories = await runTypedFd("d", "directory", 0);
    if (!directories) {
      return [];
    }

    const files = directoryOnly ? [] : await runTypedFd("f", "file", directories.length);
    if (!files) {
      return [];
    }

    const entries = [...directories, ...files];
    return rankEntries(entries, query, limit);
  } catch {
    return [];
  }
}

async function runFind(query: string | null, cwd: string, limit: number): Promise<FileEntry[]> {
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
    const ignoreDirsExpr = ignoreDirs.flatMap((d) => ["-not", "-path", `*/${d}/*`]);
    const searchQuery = normalizeQuery(query);
    const directoryOnly = isDirectoryIntent(query);

    const runTypedFind = async (
      type: "f" | "d",
      kind: "file" | "directory",
      startIndex: number,
    ): Promise<Array<FileEntry & { score: number; index: number }> | null> => {
      const args = [".", "-type", type];
      if (searchQuery) {
        const escaped = searchQuery.replace(/[.*?[\]()]/g, "\\$&");
        args.push("-name", `*${escaped}*`);
      }
      args.push(...ignoreDirsExpr);

      const { done } = spawnPiped("find", args, { cwd });
      const result = await done;
      if (result.spawnError) {
        return null;
      }
      return result.stdout
        .split("\n")
        .filter((p) => p && p !== ".")
        .map((p, offset) => ({
          path: normalizeRelativePath(p),
          kind,
          score: 0,
          index: startIndex + offset,
        }));
    };

    const directories = await runTypedFind("d", "directory", 0);
    if (!directories) {
      return [];
    }

    const files = directoryOnly ? [] : await runTypedFind("f", "file", directories.length);
    if (!files) {
      return [];
    }

    const entries = [...directories, ...files];
    return rankEntries(entries, query, limit);
  } catch {
    return [];
  }
}
