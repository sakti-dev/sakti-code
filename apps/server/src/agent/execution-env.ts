import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  access as accessAsync,
  appendFile as appendFileAsync,
  lstat as lstatAsync,
  mkdir as mkdirAsync,
  mkdtemp as mkdtempAsync,
  readdir as readdirAsync,
  readFile as readFileAsync,
  realpath as realpathAsync,
  rm as rmAsync,
  writeFile as writeFileAsync,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type {
  ExecutionEnv,
  ExecutionEnvExecOptions,
  FileErrorCode,
  FileInfo,
  FileKind,
  Result,
} from "@sakti-code/agent";
import { ExecutionError, err, FileError, ok } from "@sakti-code/agent";

function mapFsErrorCode(code: string | undefined): FileErrorCode {
  switch (code) {
    case "ENOENT":
      return "not_found";
    case "EACCES":
    case "EPERM":
      return "permission_denied";
    case "EEXIST":
      return "is_directory";
    case "ENOTDIR":
      return "not_directory";
    case "EISDIR":
      return "is_directory";
    default:
      return "unknown";
  }
}

function toFileError(e: unknown, path?: string): FileError {
  if (e instanceof FileError) {
    return e;
  }
  const nodeErr = e as { code?: string };
  return new FileError(
    nodeErr.code ? mapFsErrorCode(nodeErr.code) : "unknown",
    e instanceof Error ? e.message : String(e),
    path,
    e instanceof Error ? e : undefined
  );
}

async function statToFileInfo(fullPath: string): Promise<FileInfo> {
  const s = await lstatAsync(fullPath);
  let kind: FileKind = "file";
  if (s.isSymbolicLink()) {
    kind = "symlink";
  } else if (s.isDirectory()) {
    kind = "directory";
  }
  return {
    kind,
    mtimeMs: s.mtimeMs,
    name: basename(fullPath),
    path: fullPath,
    size: s.size,
  };
}

export class BunExecutionEnv implements ExecutionEnv {
  private readonly _cwd: string;

  constructor(cwd?: string) {
    this._cwd = cwd ?? process.cwd();
  }

  get cwd(): string {
    return this._cwd;
  }

  async absolutePath(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<string, FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    return ok(resolve(this._cwd, path));
  }

  async appendFile(
    path: string,
    content: string | Uint8Array,
    signal?: AbortSignal
  ): Promise<Result<void, FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      const fullPath = resolve(this._cwd, path);
      await appendFileAsync(fullPath, content);
      return ok(undefined);
    } catch (e: unknown) {
      return err(toFileError(e, resolve(this._cwd, path)));
    }
  }

  async canonicalPath(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<string, FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      const fullPath = resolve(this._cwd, path);
      const canonical = await realpathAsync(fullPath);
      return ok(canonical);
    } catch (e: unknown) {
      return err(toFileError(e, resolve(this._cwd, path)));
    }
  }

  async cleanup(): Promise<void> {}

  async createDir(
    path: string,
    options?: { recursive?: boolean; abortSignal?: AbortSignal }
  ): Promise<Result<void, FileError>> {
    if (options?.abortSignal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      const fullPath = resolve(this._cwd, path);
      await mkdirAsync(fullPath, { recursive: options?.recursive });
      return ok(undefined);
    } catch (e: unknown) {
      return err(toFileError(e, resolve(this._cwd, path)));
    }
  }

  async createTempDir(
    prefix?: string,
    signal?: AbortSignal
  ): Promise<Result<string, FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      const dirPath = await mkdtempAsync(join(tmpdir(), prefix ?? "tmp-"));
      return ok(dirPath);
    } catch (e: unknown) {
      return err(toFileError(e));
    }
  }

  async createTempFile(options?: {
    prefix?: string;
    suffix?: string;
    abortSignal?: AbortSignal;
  }): Promise<Result<string, FileError>> {
    if (options?.abortSignal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      const dirPath = await mkdtempAsync(join(tmpdir(), "tmp-"));
      const filePath = join(
        dirPath,
        `${options?.prefix ?? ""}${Date.now()}${options?.suffix ?? ""}`
      );
      writeFileSync(filePath, new Uint8Array(0));
      return ok(filePath);
    } catch (e: unknown) {
      return err(toFileError(e));
    }
  }

  async exists(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<boolean, FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      await accessAsync(resolve(this._cwd, path));
      return ok(true);
    } catch (e: unknown) {
      const nodeErr = e as { code?: string };
      if (nodeErr.code === "ENOENT") {
        return ok(false);
      }
      return err(toFileError(e, resolve(this._cwd, path)));
    }
  }

  async fileInfo(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<FileInfo, FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      const fullPath = resolve(this._cwd, path);
      const info = await statToFileInfo(fullPath);
      return ok(info);
    } catch (e: unknown) {
      return err(toFileError(e, resolve(this._cwd, path)));
    }
  }

  async joinPath(
    parts: string[],
    signal?: AbortSignal
  ): Promise<Result<string, FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      return ok(join(this._cwd, ...parts));
    } catch (e: unknown) {
      return err(toFileError(e));
    }
  }

  async listDir(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<FileInfo[], FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      const dirPath = resolve(this._cwd, path);
      const entries = await readdirAsync(dirPath, { withFileTypes: true });
      const infos: FileInfo[] = [];
      for (const entry of entries) {
        const info = await statToFileInfo(join(dirPath, entry.name));
        infos.push(info);
      }
      return ok(infos);
    } catch (e: unknown) {
      return err(toFileError(e, resolve(this._cwd, path)));
    }
  }

  async readBinaryFile(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<Uint8Array, FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      const fullPath = resolve(this._cwd, path);
      const data = await readFileAsync(fullPath);
      return ok(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } catch (e: unknown) {
      return err(toFileError(e, resolve(this._cwd, path)));
    }
  }

  async readTextFile(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<string, FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      const fullPath = resolve(this._cwd, path);
      const data = await readFileAsync(fullPath, "utf-8");
      return ok(data);
    } catch (e: unknown) {
      return err(toFileError(e, resolve(this._cwd, path)));
    }
  }

  async readTextLines(
    path: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal }
  ): Promise<Result<string[], FileError>> {
    if (options?.abortSignal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    const result = await this.readTextFile(path, options?.abortSignal);
    if (!result.ok) {
      return result;
    }
    const lines = result.value.split("\n");
    return ok(options?.maxLines ? lines.slice(0, options.maxLines) : lines);
  }

  async remove(
    path: string,
    options?: {
      recursive?: boolean;
      force?: boolean;
      abortSignal?: AbortSignal;
    }
  ): Promise<Result<void, FileError>> {
    if (options?.abortSignal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      const fullPath = resolve(this._cwd, path);
      await rmAsync(fullPath, {
        recursive: options?.recursive,
        force: options?.force,
      });
      return ok(undefined);
    } catch (e: unknown) {
      return err(toFileError(e, resolve(this._cwd, path)));
    }
  }

  async writeFile(
    path: string,
    content: string | Uint8Array,
    signal?: AbortSignal
  ): Promise<Result<void, FileError>> {
    if (signal?.aborted) {
      return err(new FileError("aborted", "Operation aborted"));
    }
    try {
      const fullPath = resolve(this._cwd, path);
      await writeFileAsync(fullPath, content);
      return ok(undefined);
    } catch (e: unknown) {
      return err(toFileError(e, resolve(this._cwd, path)));
    }
  }

  async exec(
    command: string,
    options?: ExecutionEnvExecOptions
  ): Promise<
    Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>
  > {
    if (options?.abortSignal?.aborted) {
      return err(new ExecutionError("aborted", "Command aborted"));
    }
    try {
      const timeoutMs = options?.timeout ? options.timeout * 1000 : undefined;
      const stdout = execFileSync("/bin/sh", ["-c", command], {
        cwd: options?.cwd ?? this._cwd,
        env: options?.env ? { ...process.env, ...options.env } : undefined,
        encoding: "utf-8" as BufferEncoding,
        timeout: timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return ok({ stdout, stderr: "", exitCode: 0 });
    } catch (e: unknown) {
      if (options?.abortSignal?.aborted) {
        return err(
          new ExecutionError(
            "aborted",
            "Command aborted",
            e instanceof Error ? e : undefined
          )
        );
      }
      const nodeErr = e as {
        stdout?: string;
        stderr?: string;
        status?: number;
        message?: string;
      };
      const isTimeout =
        nodeErr.message?.includes("timed out") ||
        nodeErr.message?.includes("ETIMEDOUT");
      if (isTimeout) {
        return err(
          new ExecutionError(
            "timeout",
            nodeErr.stderr ?? "Command timed out",
            e instanceof Error ? e : undefined
          )
        );
      }
      return err(
        new ExecutionError(
          nodeErr.status === 127 ? "shell_unavailable" : "unknown",
          nodeErr.stderr ?? nodeErr.message ?? String(e),
          e instanceof Error ? e : undefined
        )
      );
    }
  }
}
