import {
  accessSync,
  appendFileSync,
  constants,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type {
  ExecutionEnv,
  ExecutionEnvExecOptions,
  FileError,
  FileInfo,
  Result,
} from "../../harness/types.ts";
import {
  type ExecutionError,
  err,
  FileError as FileErrorClass,
  ok,
} from "../../harness/types.ts";

function statToFileInfo(fullPath: string, name: string): FileInfo {
  const s = lstatSync(fullPath);
  let kind: "file" | "directory" | "symlink";
  if (s.isSymbolicLink()) {
    kind = "symlink";
  } else if (s.isDirectory()) {
    kind = "directory";
  } else {
    kind = "file";
  }
  return { kind, mtimeMs: s.mtimeMs, name, path: fullPath, size: s.size };
}

function toFileError(e: unknown): FileError {
  if (e instanceof FileErrorClass) {
    return e;
  }
  const nodeErr = e as NodeJS.ErrnoException;
  const code =
    nodeErr?.code === "ENOENT"
      ? "not_found"
      : nodeErr?.code === "EACCES"
        ? "permission_denied"
        : nodeErr?.code === "EEXIST"
          ? "invalid"
          : nodeErr?.code === "ENOTDIR"
            ? "not_directory"
            : nodeErr?.code === "EISDIR"
              ? "is_directory"
              : "unknown";
  return new FileErrorClass(code, e instanceof Error ? e.message : String(e));
}

export class TestExecutionEnv implements ExecutionEnv {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  get cwd(): string {
    return this.rootDir;
  }

  async absolutePath(
    path: string,
    _abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>> {
    return Promise.resolve(
      ok(isAbsolute(path) ? path : resolve(this.rootDir, path))
    );
  }

  async appendFile(
    path: string,
    content: string | Uint8Array,
    _abortSignal?: AbortSignal
  ): Promise<Result<void, FileError>> {
    try {
      appendFileSync(resolve(this.rootDir, path), content);
      return Promise.resolve(ok(undefined));
    } catch (e) {
      return Promise.resolve(err(toFileError(e)));
    }
  }

  async canonicalPath(
    path: string,
    _abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>> {
    try {
      return Promise.resolve(ok(realpathSync(resolve(this.rootDir, path))));
    } catch {
      return Promise.resolve(ok(resolve(this.rootDir, path)));
    }
  }

  cleanup(): Promise<void> {
    return Promise.resolve();
  }

  async createDir(
    path: string,
    options?: { recursive?: boolean; abortSignal?: AbortSignal }
  ): Promise<Result<void, FileError>> {
    try {
      mkdirSync(resolve(this.rootDir, path), { recursive: options?.recursive });
      return Promise.resolve(ok(undefined));
    } catch (e) {
      return Promise.resolve(err(toFileError(e)));
    }
  }

  async createTempDir(
    _prefix?: string,
    _abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>> {
    const dir = join(
      this.rootDir,
      `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(dir, { recursive: true });
    return Promise.resolve(ok(dir));
  }

  async createTempFile(options?: {
    prefix?: string;
    suffix?: string;
    abortSignal?: AbortSignal;
  }): Promise<Result<string, FileError>> {
    const dir = join(this.rootDir, `tmp-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(
      dir,
      `${options?.prefix ?? ""}${Date.now()}${options?.suffix ?? ""}`
    );
    writeFileSync(file, "");
    return Promise.resolve(ok(file));
  }

  async exists(
    path: string,
    _abortSignal?: AbortSignal
  ): Promise<Result<boolean, FileError>> {
    try {
      accessSync(resolve(this.rootDir, path), constants.F_OK);
      return Promise.resolve(ok(true));
    } catch {
      return Promise.resolve(ok(false));
    }
  }

  async exec(
    command: string,
    options?: ExecutionEnvExecOptions
  ): Promise<
    Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>
  > {
    const result = Bun.spawnSync(["/bin/sh", "-c", command], {
      cwd: options?.cwd ?? this.rootDir,
    });
    return Promise.resolve(
      ok({
        stdout: result.stdout?.toString() ?? "",
        stderr: result.stderr?.toString() ?? "",
        exitCode: result.exitCode ?? -1,
      })
    );
  }

  async fileInfo(
    path: string,
    _abortSignal?: AbortSignal
  ): Promise<Result<FileInfo, FileError>> {
    try {
      const fullPath = resolve(this.rootDir, path);
      const name = path.split("/").pop() ?? path;
      return Promise.resolve(ok(statToFileInfo(fullPath, name)));
    } catch (e) {
      return Promise.resolve(err(toFileError(e)));
    }
  }

  async joinPath(
    parts: string[],
    _abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>> {
    return Promise.resolve(ok(resolve(this.rootDir, ...parts)));
  }

  async listDir(
    path: string,
    _abortSignal?: AbortSignal
  ): Promise<Result<FileInfo[], FileError>> {
    try {
      const dirPath = resolve(this.rootDir, path);
      const entries = readdirSync(dirPath, { withFileTypes: true });
      return Promise.resolve(
        ok(entries.map((e) => statToFileInfo(join(dirPath, e.name), e.name)))
      );
    } catch (e) {
      return Promise.resolve(err(toFileError(e)));
    }
  }

  async readBinaryFile(
    path: string,
    _abortSignal?: AbortSignal
  ): Promise<Result<Uint8Array, FileError>> {
    try {
      return Promise.resolve(
        ok(new Uint8Array(readFileSync(resolve(this.rootDir, path))))
      );
    } catch (e) {
      return Promise.resolve(err(toFileError(e)));
    }
  }

  async readTextFile(
    path: string,
    _abortSignal?: AbortSignal
  ): Promise<Result<string, FileError>> {
    try {
      return Promise.resolve(
        ok(readFileSync(resolve(this.rootDir, path), "utf-8"))
      );
    } catch (e) {
      return Promise.resolve(err(toFileError(e)));
    }
  }

  async readTextLines(
    path: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal }
  ): Promise<Result<string[], FileError>> {
    const result = await this.readTextFile(path);
    if (!result.ok) {
      return result;
    }
    const lines = result.value.split("\n");
    return Promise.resolve(
      ok(options?.maxLines ? lines.slice(0, options.maxLines) : lines)
    );
  }

  async remove(
    path: string,
    options?: {
      recursive?: boolean;
      force?: boolean;
      abortSignal?: AbortSignal;
    }
  ): Promise<Result<void, FileError>> {
    try {
      rmSync(resolve(this.rootDir, path), {
        recursive: options?.recursive,
        force: options?.force,
      });
      return Promise.resolve(ok(undefined));
    } catch (e) {
      return Promise.resolve(err(toFileError(e)));
    }
  }

  async writeFile(
    path: string,
    content: string | Uint8Array,
    _abortSignal?: AbortSignal
  ): Promise<Result<void, FileError>> {
    try {
      writeFileSync(resolve(this.rootDir, path), content);
      return Promise.resolve(ok(undefined));
    } catch (e) {
      return Promise.resolve(err(toFileError(e)));
    }
  }
}
