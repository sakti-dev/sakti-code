import { readdir as fsReaddir, stat as fsStat } from "node:fs/promises";
import nodePath from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "../lib/truncate.ts";

export interface Entry {
  path: string;
  type: "file" | "directory";
}

export interface ListPage {
  entries: Entry[];
  truncated: boolean;
  next?: number;
}

export interface TextPage {
  content: string;
  offset: number;
  truncated: boolean;
  next?: number;
}

export interface ReadFileSystemOperations {
  readdir: (absolutePath: string) => Promise<string[]>;
  stat: (absolutePath: string) => Promise<{
    isFile: () => boolean;
    isDirectory: () => boolean;
  }>;
  realpath: (absolutePath: string) => Promise<string>;
}

const defaultReadFileSystemOperations: ReadFileSystemOperations = {
  readdir: fsReaddir,
  stat: fsStat,
  realpath: async (absolutePath) => {
    const { realpath } = await import("node:fs/promises");
    return realpath(absolutePath);
  },
};

export interface ReadFileSystemOptions {
  operations?: ReadFileSystemOperations;
}

const LIST_CONCURRENCY = 16;

export async function inspect(absolutePath: string): Promise<"file" | "directory"> {
  const info = await fsStat(absolutePath);
  if (info.isFile()) {
    return "file";
  }
  if (info.isDirectory()) {
    return "directory";
  }
  throw new Error(`Path is not a file or directory: ${absolutePath}`);
}

function contains(parent: string, child: string): boolean {
  const relative = nodePath.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !nodePath.isAbsolute(relative));
}

async function runWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = Array.from({ length: items.length });
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex]!);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export async function list(
  absolutePath: string,
  page?: { offset?: number | undefined; limit?: number | undefined },
  options?: ReadFileSystemOptions,
): Promise<ListPage> {
  const ops = options?.operations ?? defaultReadFileSystemOperations;
  const names = await ops.readdir(absolutePath);
  const offset = page?.offset ?? 1;
  const limit = page?.limit ?? DEFAULT_MAX_LINES;

  const entries = (
    await runWithConcurrency(names, LIST_CONCURRENCY, async (name) => {
      const fullPath = nodePath.join(absolutePath, name);
      try {
        const realPath = await ops.realpath(fullPath);
        if (!contains(absolutePath, realPath)) {
          return undefined;
        }
        const info = await ops.stat(realPath);
        if (info.isDirectory()) {
          return { path: `${name}/`, type: "directory" as const };
        }
        if (info.isFile()) {
          return { path: name, type: "file" as const };
        }
        return undefined;
      } catch {
        return undefined;
      }
    })
  ).filter((entry): entry is Entry => entry !== undefined);

  entries.sort((a, b) => {
    if (a.type === b.type) {
      return a.path.toLowerCase().localeCompare(b.path.toLowerCase());
    }
    return a.type === "directory" ? -1 : 1;
  });

  const selected = entries.slice(offset - 1, offset - 1 + limit);
  const truncated = offset - 1 + selected.length < entries.length;

  return {
    entries: selected,
    truncated,
    ...(truncated ? { next: offset + selected.length } : {}),
  };
}

export function formatListPage(
  page: ListPage,
  pageInput?: { offset?: number | undefined; limit?: number | undefined },
): string {
  if (page.entries.length === 0) {
    return "(empty directory)";
  }

  const rawOutput = page.entries.map((entry) => entry.path).join("\n");
  const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
  const notices: string[] = [];

  if (page.truncated) {
    const nextOffset = page.next ?? (pageInput?.offset ?? 1) + page.entries.length;
    notices.push(`Showing ${page.entries.length} entries. Use offset=${nextOffset} to continue.`);
  }

  if (truncation.truncated) {
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
  }

  let output = truncation.content;
  if (notices.length > 0) {
    output += `\n\n[${notices.join(". ")}]`;
  }

  return output;
}

export async function readText(
  absolutePath: string,
  page?: { offset?: number | undefined; limit?: number | undefined },
): Promise<TextPage> {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(absolutePath);
  const textContent = buffer.toString("utf-8");
  const allLines = textContent.split("\n");
  const totalFileLines = allLines.length;

  const startLine = page?.offset ? Math.max(0, page.offset - 1) : 0;
  const startLineDisplay = startLine + 1;

  if (startLine >= allLines.length) {
    throw new Error(
      `Offset ${page?.offset} is beyond end of file (${allLines.length} lines total)`,
    );
  }

  let selectedContent: string;
  let userLimitedLines: number | undefined;

  if (page?.limit === undefined) {
    selectedContent = allLines.slice(startLine).join("\n");
  } else {
    const endLine = Math.min(startLine + page.limit, allLines.length);
    selectedContent = allLines.slice(startLine, endLine).join("\n");
    userLimitedLines = endLine - startLine;
  }

  const truncation = truncateHead(selectedContent);
  const displayContent = truncation.content;
  const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
  let next: number | undefined;
  const notices: string[] = [];

  if (truncation.truncated) {
    next = endLineDisplay + 1;
    if (truncation.truncatedBy === "lines") {
      notices.push(
        `[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${next} to continue.]`,
      );
    } else {
      notices.push(
        `[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${next} to continue.]`,
      );
    }
  } else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
    next = startLine + userLimitedLines + 1;
    const remaining = allLines.length - (startLine + userLimitedLines);
    notices.push(`[${remaining} more lines in file. Use offset=${next} to continue.]`);
  }

  let content = displayContent;
  if (notices.length > 0) {
    content = `${content}\n\n${notices.join("\n")}`;
  }

  return {
    content,
    offset: startLineDisplay,
    truncated: next !== undefined,
    ...(next !== undefined ? { next } : {}),
  };
}
