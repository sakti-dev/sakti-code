import { execSync } from "node:child_process";
import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { ExecutionEnv, FileError, FileInfo } from "../../harness/types.ts";
import { err, ok } from "../../harness/types.ts";

function statToFileInfo(
  _rootDir: string,
  fullPath: string,
  name: string
): FileInfo {
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

export class TestExecutionEnv implements ExecutionEnv {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  get cwd(): string {
    return this.rootDir;
  }

  async createDir(
    path: string,
    options?: { recursive?: boolean; abortSignal?: AbortSignal }
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<string>>
      : ReturnType<typeof err>
  > {
    try {
      mkdirSync(resolve(this.rootDir, path), { recursive: options?.recursive });
      return ok(resolve(this.rootDir, path));
    } catch (e: unknown) {
      const code =
        (e as NodeJS.ErrnoException).code === "EEXIST"
          ? "already_exists"
          : "write_failed";
      return err({ code } as FileError);
    }
  }

  async writeFile(
    path: string,
    content: string,
    _options?: { abortSignal?: AbortSignal }
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<void>>
      : ReturnType<typeof err>
  > {
    try {
      writeFileSync(resolve(this.rootDir, path), content);
      return ok(undefined);
    } catch {
      return err({ code: "write_failed" } as FileError);
    }
  }

  async readTextFile(
    path: string,
    _signal?: AbortSignal
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<string>>
      : ReturnType<typeof err>
  > {
    try {
      return ok(readFileSync(resolve(this.rootDir, path), "utf-8"));
    } catch {
      return err({ code: "not_found" } as FileError);
    }
  }

  async fileInfo(
    path: string,
    _signal?: AbortSignal
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<FileInfo>>
      : ReturnType<typeof err>
  > {
    try {
      const fullPath = resolve(this.rootDir, path);
      const name = path.split("/").pop() ?? path;
      return ok(statToFileInfo(this.rootDir, fullPath, name));
    } catch {
      return err({ code: "not_found" } as FileError);
    }
  }

  async exists(
    path: string,
    _signal?: AbortSignal
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<boolean>>
      : ReturnType<typeof err>
  > {
    try {
      accessSync(resolve(this.rootDir, path), constants.F_OK);
      return ok(true);
    } catch {
      return ok(false);
    }
  }

  async listDir(
    path: string,
    _signal?: AbortSignal
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<FileInfo[]>>
      : ReturnType<typeof err>
  > {
    try {
      const dirPath = resolve(this.rootDir, path);
      const entries = readdirSync(dirPath, { withFileTypes: true });
      return ok(
        entries.map((e) =>
          statToFileInfo(this.rootDir, join(dirPath, e.name), e.name)
        )
      );
    } catch {
      return err({ code: "not_found" } as FileError);
    }
  }

  async joinPath(
    parts: string[],
    _signal?: AbortSignal
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<string>>
      : ReturnType<typeof err>
  > {
    return ok(resolve(this.rootDir, ...parts));
  }

  async canonicalPath(
    path: string,
    _signal?: AbortSignal
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<string>>
      : ReturnType<typeof err>
  > {
    try {
      return ok(realpathSync(resolve(this.rootDir, path)));
    } catch {
      return ok(resolve(this.rootDir, path));
    }
  }

  async readBinaryFile(
    path: string,
    _signal?: AbortSignal
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<Uint8Array>>
      : ReturnType<typeof err>
  > {
    try {
      return ok(new Uint8Array(readFileSync(resolve(this.rootDir, path))));
    } catch {
      return err({ code: "not_found" } as FileError);
    }
  }

  async readTextLines(
    path: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal }
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<string[]>>
      : ReturnType<typeof err>
  > {
    const result = await this.readTextFile(path);
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
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<void>>
      : ReturnType<typeof err>
  > {
    try {
      rmSync(resolve(this.rootDir, path), {
        recursive: options?.recursive,
        force: options?.force,
      });
      return ok(undefined);
    } catch {
      return err({ code: "write_failed" } as FileError);
    }
  }

  async createTempDir(
    _prefix?: string,
    _signal?: AbortSignal
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<string>>
      : ReturnType<typeof err>
  > {
    const dir = join(
      this.rootDir,
      `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(dir, { recursive: true });
    return ok(dir);
  }

  async createTempFile(options?: {
    prefix?: string;
    suffix?: string;
    abortSignal?: AbortSignal;
  }): Promise<
    typeof ok extends typeof err
      ? ReturnType<typeof ok<string>>
      : ReturnType<typeof err>
  > {
    const dir = join(this.rootDir, `tmp-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(
      dir,
      `${options?.prefix ?? ""}${Date.now()}${options?.suffix ?? ""}`
    );
    writeFileSync(file, "");
    return ok(file);
  }

  async exec(
    command: string,
    _options?: { cwd?: string; timeout?: number; abortSignal?: AbortSignal }
  ): Promise<
    typeof ok extends typeof err
      ? ReturnType<
          typeof ok<{ stdout: string; stderr: string; exitCode: number }>
        >
      : ReturnType<typeof err>
  > {
    try {
      const stdout = execSync(command, {
        encoding: "utf-8",
        cwd: this.rootDir,
      });
      return ok({ stdout, stderr: "", exitCode: 0 });
    } catch (e: unknown) {
      const err2 = e as { stdout?: string; stderr?: string; status?: number };
      return err({ code: "exec_failed", message: err2.stderr ?? String(e) });
    }
  }

  cleanup(): Promise<void> {
    return Promise.resolve();
  }
}
