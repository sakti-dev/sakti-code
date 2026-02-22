import { createLogger } from "@sakti-code/shared/logger";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { LSPServerInfo } from "./types";

const logger = createLogger("sakti-code:lsp:server");

export interface LSPServerDefinition extends LSPServerInfo {
  rootPatterns: string[];
  spawn(rootPath: string): Promise<
    | {
        process: ChildProcessWithoutNullStreams;
        initializationOptions?: Record<string, unknown>;
      }
    | undefined
  >;
}

async function findRootDir(filePath: string, patterns: string[]): Promise<string | undefined> {
  let currentDir = path.dirname(filePath);

  while (currentDir !== path.dirname(currentDir)) {
    for (const pattern of patterns) {
      try {
        const stat = await fs.stat(path.join(currentDir, pattern));
        if (stat.isFile()) {
          return currentDir;
        }
      } catch {
        // Pattern doesn't exist at this location
      }
    }
    currentDir = path.dirname(currentDir);
  }

  return undefined;
}

async function whichBinary(name: string, _cwd?: string): Promise<string | undefined> {
  const pathEnv = process.env.PATH || "";
  const pathDirs = pathEnv.split(path.delimiter);

  const ext = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];

  for (const dir of pathDirs) {
    for (const e of ext) {
      const candidate = path.join(dir, name + e);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Not accessible
      }
    }
  }

  return undefined;
}

class LSPServerRegistryImpl {
  private servers = new Map<string, LSPServerDefinition>();

  register(server: LSPServerDefinition): void {
    this.servers.set(server.id, server);
    logger.info("registered LSP server", { id: server.id, name: server.name });
  }

  getServer(id: string): LSPServerDefinition | undefined {
    return this.servers.get(id);
  }

  getAllServers(): LSPServerDefinition[] {
    return Array.from(this.servers.values());
  }

  async detectServer(filePath: string): Promise<LSPServerDefinition | undefined> {
    const ext = path.extname(filePath).toLowerCase();

    for (const server of this.servers.values()) {
      if (server.extensions.includes(ext)) {
        logger.info("detected LSP server", {
          filePath,
          extension: ext,
          serverId: server.id,
        });
        return server;
      }
    }

    logger.info("no LSP server found", { filePath, extension: ext });
    return undefined;
  }

  async findRoot(filePath: string): Promise<string | undefined> {
    const server = await this.detectServer(filePath);
    if (!server) {
      return undefined;
    }

    const root = await findRootDir(filePath, server.rootPatterns);
    return root || path.dirname(filePath);
  }
}

export const LSPServerRegistry = new LSPServerRegistryImpl();

LSPServerRegistry.register({
  id: "typescript",
  name: "TypeScript Language Server",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  rootPatterns: ["package.json", "tsconfig.json", "jsconfig.json"],
  async spawn(rootPath: string) {
    logger.info("spawning TypeScript server", { rootPath });

    let binary = await whichBinary("typescript-language-server");
    const args = ["--stdio"];

    if (!binary) {
      const localTsserver = path.join(
        rootPath,
        "node_modules",
        ".bin",
        "typescript-language-server"
      );
      try {
        await fs.access(localTsserver);
        binary = localTsserver;
      } catch {
        // Not found in local node_modules
      }
    }

    if (!binary) {
      const tsserverLocal = path.join(rootPath, "node_modules", "typescript", "lib", "tsserver.js");
      try {
        await fs.access(tsserverLocal);
        binary = process.execPath;
        args.unshift(tsserverLocal);
      } catch {
        // Not found
      }
    }

    if (!binary) {
      logger.warn("typescript-language-server not found");
      return undefined;
    }

    logger.info("spawning tsserver", { binary, args, rootPath });

    const proc = spawn(binary, args, {
      cwd: rootPath,
      env: {
        ...process.env,
        NODE_OPTIONS: "--max-old-space-size=4096",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    return {
      process: proc,
      initializationOptions: {},
    };
  },
});

LSPServerRegistry.register({
  id: "pyright",
  name: "Pyright",
  extensions: [".py", ".pyi"],
  rootPatterns: [
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "setup.cfg",
    "Pipfile",
    "pyrightconfig.json",
  ],
  async spawn(rootPath: string) {
    logger.info("spawning Pyright server", { rootPath });

    let binary = await whichBinary("pyright-langserver");
    const args = ["--stdio"];

    if (!binary) {
      const localPyright = path.join(rootPath, "node_modules", ".bin", "pyright-langserver");
      try {
        await fs.access(localPyright);
        binary = localPyright;
      } catch {
        // Not found in local node_modules
      }
    }

    if (!binary) {
      const pyrightLocal = path.join(
        rootPath,
        "node_modules",
        "pyright",
        "dist",
        "pyright-langserver.js"
      );
      try {
        await fs.access(pyrightLocal);
        binary = process.execPath;
        args.unshift(pyrightLocal);
      } catch {
        // Not found
      }
    }

    if (!binary) {
      logger.warn("pyright-langserver not found");
      return undefined;
    }

    logger.info("spawning pyright", { binary, args, rootPath });

    const proc = spawn(binary, args, {
      cwd: rootPath,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return {
      process: proc,
      initializationOptions: {},
    };
  },
});

LSPServerRegistry.register({
  id: "gopls",
  name: "Go Language Server",
  extensions: [".go"],
  rootPatterns: ["go.mod", "go.sum", "go.work"],
  async spawn(rootPath: string) {
    logger.info("spawning gopls server", { rootPath });

    const binary = await whichBinary("gopls");
    if (!binary) {
      logger.warn("gopls not found");
      return undefined;
    }

    const proc = spawn(binary, ["-mode", "stdio"], {
      cwd: rootPath,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return {
      process: proc,
      initializationOptions: {},
    };
  },
});

LSPServerRegistry.register({
  id: "rust-analyzer",
  name: "Rust Analyzer",
  extensions: [".rs"],
  rootPatterns: ["Cargo.toml", "Cargo.lock"],
  async spawn(rootPath: string) {
    logger.info("spawning rust-analyzer server", { rootPath });

    const binary = await whichBinary("rust-analyzer");
    if (!binary) {
      logger.warn("rust-analyzer not found");
      return undefined;
    }

    const proc = spawn(binary, [], {
      cwd: rootPath,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return {
      process: proc,
      initializationOptions: {},
    };
  },
});

LSPServerRegistry.register({
  id: "clangd",
  name: "Clangd",
  extensions: [".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh", ".hxx"],
  rootPatterns: ["compile_commands.json", "compile_flags.txt", "CMakeLists.txt"],
  async spawn(rootPath: string) {
    logger.info("spawning clangd server", { rootPath });

    const binary = await whichBinary("clangd");
    if (!binary) {
      logger.warn("clangd not found");
      return undefined;
    }

    const args = ["--background-index", "--clang-tidy"];
    const proc = spawn(binary, args, {
      cwd: rootPath,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return {
      process: proc,
      initializationOptions: {},
    };
  },
});

LSPServerRegistry.register({
  id: "json-ls",
  name: "JSON Language Server",
  extensions: [".json", ".jsonc"],
  rootPatterns: [],
  async spawn(rootPath: string) {
    logger.info("spawning JSON server", { rootPath });

    const vscodeJson = path.join(
      rootPath,
      "node_modules",
      "vscode-json-languageserver",
      "bin",
      "vscode-json-languageserver"
    );
    let binary = vscodeJson;

    try {
      await fs.access(binary);
    } catch {
      binary = (await whichBinary("vscode-json-languageserver")) || "";
    }

    if (!binary) {
      logger.warn("json-languageserver not found");
      return undefined;
    }

    const proc = spawn(binary, ["--stdio"], {
      cwd: rootPath,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return {
      process: proc,
      initializationOptions: {},
    };
  },
});

LSPServerRegistry.register({
  id: "yaml-ls",
  name: "YAML Language Server",
  extensions: [".yaml", ".yml"],
  rootPatterns: [],
  async spawn(rootPath: string) {
    logger.info("spawning YAML server", { rootPath });

    const yamlLs = path.join(rootPath, "node_modules", ".bin", "yaml-language-server");
    let binary = yamlLs;
    const args = ["--stdio"];

    try {
      await fs.access(binary);
    } catch {
      const yamlLsJs = path.join(
        rootPath,
        "node_modules",
        "yaml-language-server",
        "out",
        "server",
        "src",
        "server.js"
      );
      try {
        await fs.access(yamlLsJs);
        binary = process.execPath;
        args.unshift(yamlLsJs);
      } catch {
        binary = (await whichBinary("yaml-language-server")) || "";
      }
    }

    if (!binary) {
      logger.warn("yaml-language-server not found");
      return undefined;
    }

    const proc = spawn(binary, args, {
      cwd: rootPath,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    return {
      process: proc,
      initializationOptions: {},
    };
  },
});
