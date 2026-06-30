import * as fsp from "node:fs/promises";
import * as pathModule from "node:path";
import type { FileOp } from "../../lib/hashline-utils/types";

export interface WriteResult {
  text: string;
}

export interface PreflightWriteOptions {
  fileOp?: FileOp;
}

export class NotFoundError extends Error {
  readonly code = "ENOENT";

  constructor(path: string, cause?: unknown) {
    super(`File not found: ${path}`);
    this.name = "NotFoundError";
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export function isNotFound(error: unknown): boolean {
  if (error instanceof NotFoundError) {
    return true;
  }
  if (error instanceof Error && (error as Error & { code?: string }).code === "ENOENT") {
    return true;
  }
  return false;
}

export abstract class Filesystem {
  abstract readText(path: string): Promise<string>;

  async preflightWrite(_path: string, _options?: PreflightWriteOptions): Promise<void> {}

  abstract writeText(path: string, content: string): Promise<WriteResult>;

  async delete(path: string): Promise<void> {
    throw new Error(`Filesystem does not support delete: ${path}`);
  }

  async move(from: string, to: string, content?: string): Promise<void> {
    void content;
    throw new Error(`Filesystem does not support move: ${from} -> ${to}`);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.readText(path);
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  canonicalPath(path: string): string {
    return path;
  }

  allowTagPathRecovery(_authoredPath: string, _resolvedPath: string): boolean {
    return true;
  }
}

export class InMemoryFilesystem extends Filesystem {
  #files = new Map<string, string>();

  constructor(initial?: Iterable<readonly [string, string]>) {
    super();
    if (initial) {
      for (const [path, content] of initial) {
        this.#files.set(path, content);
      }
    }
  }

  async readText(path: string): Promise<string> {
    const text = this.#files.get(path);
    if (text === undefined) {
      throw new NotFoundError(path);
    }
    return text;
  }

  async writeText(path: string, content: string): Promise<WriteResult> {
    this.#files.set(path, content);
    return { text: content };
  }

  async delete(path: string): Promise<void> {
    if (!this.#files.delete(path)) {
      throw new NotFoundError(path);
    }
  }

  async move(from: string, to: string, content?: string): Promise<void> {
    const existing = this.#files.get(from);
    if (existing === undefined) {
      throw new NotFoundError(from);
    }
    const finalContent = content ?? existing;
    this.#files.set(to, finalContent);
    this.#files.delete(from);
  }

  async exists(path: string): Promise<boolean> {
    return this.#files.has(path);
  }

  set(path: string, content: string): void {
    this.#files.set(path, content);
  }

  get(path: string): string | undefined {
    return this.#files.get(path);
  }

  clear(): void {
    this.#files.clear();
  }

  entries(): IterableIterator<[string, string]> {
    return this.#files.entries();
  }
}

export class NodeFilesystem extends Filesystem {
  readonly baseDir: string | undefined;

  constructor(baseDir?: string) {
    super();
    this.baseDir = baseDir;
  }

  async readText(path: string): Promise<string> {
    const resolved = this.#resolve(path);
    try {
      return await fsp.readFile(resolved, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        throw new NotFoundError(path, error);
      }
      throw error;
    }
  }

  async writeText(path: string, content: string): Promise<WriteResult> {
    const resolved = this.#resolve(path);
    await fsp.writeFile(resolved, content, "utf8");
    return { text: content };
  }

  async delete(path: string): Promise<void> {
    const resolved = this.#resolve(path);
    try {
      await fsp.rm(resolved);
    } catch (error) {
      if (isNotFound(error)) {
        throw new NotFoundError(path, error);
      }
      throw error;
    }
  }

  async move(from: string, to: string, content?: string): Promise<void> {
    const fromResolved = this.#resolve(from);
    const toResolved = this.#resolve(to);
    if (content !== undefined) {
      await fsp.writeFile(toResolved, content, "utf8");
      await this.delete(from);
      return;
    }
    try {
      await fsp.rename(fromResolved, toResolved);
    } catch (error) {
      if (isNotFound(error)) {
        throw new NotFoundError(from, error);
      }
      throw error;
    }
  }

  canonicalPath(path: string): string {
    return this.#resolve(path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fsp.access(this.#resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  #resolve(path: string): string {
    return this.baseDir === undefined
      ? pathModule.resolve(path)
      : pathModule.resolve(this.baseDir, path);
  }
}
