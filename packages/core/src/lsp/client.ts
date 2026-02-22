import { createLogger } from "@sakti-code/shared/logger";
import { type ChildProcessWithoutNullStreams } from "child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types";
import { LANGUAGE_EXTENSIONS } from "./language";
import type { LSPDiagnostic } from "./types";

const DIAGNOSTICS_DEBOUNCE_MS = 150;
const INITIALIZE_TIMEOUT_MS = 45_000;
const DIAGNOSTICS_WAIT_MS = 3_000;

const logger = createLogger("sakti-code:lsp:client");

export interface LSPHandle {
  process: ChildProcessWithoutNullStreams;
  initializationOptions?: Record<string, unknown>;
}

export interface LSPClientInstance {
  serverId: string;
  root: string;
  connection: MessageConnection;
  diagnostics: Map<string, LSPDiagnostic[]>;
  notifyOpen(filePath: string): Promise<void>;
  waitForDiagnostics(filePath: string): Promise<void>;
  shutdown(): Promise<void>;
}

function vscodeDiagnosticToLSP(diagnostic: VSCodeDiagnostic): LSPDiagnostic {
  return {
    severity: diagnostic.severity as 1 | 2 | 3 | 4,
    message: diagnostic.message,
    range: {
      start: {
        line: diagnostic.range.start.line,
        character: diagnostic.range.start.character,
      },
      end: {
        line: diagnostic.range.end.line,
        character: diagnostic.range.end.character,
      },
    },
    source: diagnostic.source,
  };
}

export const LSPClient = {
  async create(input: {
    serverId: string;
    handle: LSPHandle;
    root: string;
  }): Promise<LSPClientInstance> {
    logger.info("starting client", { serverId: input.serverId, root: input.root });

    const connection = createMessageConnection(
      new StreamMessageReader(input.handle.process.stdout as NodeJS.ReadableStream),
      new StreamMessageWriter(input.handle.process.stdin as NodeJS.WritableStream)
    );

    const diagnostics = new Map<string, LSPDiagnostic[]>();
    const files: Record<string, number> = {};

    connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: { uri: string; diagnostics: VSCodeDiagnostic[] }) => {
        const filePath = fileURLToPath(params.uri);
        logger.info("textDocument/publishDiagnostics", {
          path: filePath,
          count: params.diagnostics.length,
        });
        diagnostics.set(filePath, params.diagnostics.map(vscodeDiagnosticToLSP));
      }
    );

    connection.onRequest("window/workDoneProgress/create", () => {
      return null;
    });

    connection.onRequest("workspace/configuration", async () => {
      return [input.handle.initializationOptions ?? {}];
    });

    connection.onRequest("client/registerCapability", async () => {});
    connection.onRequest("client/unregisterCapability", async () => {});

    connection.onRequest("workspace/workspaceFolders", async () => [
      {
        name: "workspace",
        uri: pathToFileURL(input.root).href,
      },
    ]);

    connection.listen();

    logger.info("sending initialize");

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("LSP initialize timeout"));
      }, INITIALIZE_TIMEOUT_MS);

      connection
        .sendRequest("initialize", {
          rootUri: pathToFileURL(input.root).href,
          processId: input.handle.process.pid,
          workspaceFolders: [
            {
              name: "workspace",
              uri: pathToFileURL(input.root).href,
            },
          ],
          initializationOptions: {
            ...input.handle.initializationOptions,
          },
          capabilities: {
            window: {
              workDoneProgress: true,
            },
            workspace: {
              configuration: true,
              didChangeWatchedFiles: {
                dynamicRegistration: true,
              },
            },
            textDocument: {
              synchronization: {
                didOpen: true,
                didChange: true,
              },
              publishDiagnostics: {
                versionSupport: true,
              },
            },
          },
        })
        .then(() => {
          clearTimeout(timeout);
          resolve();
        })
        .catch(err => {
          clearTimeout(timeout);
          reject(err);
        });
    });

    await connection.sendNotification("initialized", {});

    if (input.handle.initializationOptions) {
      await connection.sendNotification("workspace/didChangeConfiguration", {
        settings: input.handle.initializationOptions,
      });
    }

    logger.info("initialized");

    return {
      get serverId() {
        return input.serverId;
      },
      get root() {
        return input.root;
      },
      get connection() {
        return connection;
      },
      get diagnostics() {
        return diagnostics;
      },
      async notifyOpen(filePath: string) {
        const absolutePath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(input.root, filePath);

        const text = await fs.readFile(absolutePath, "utf-8");
        const ext = path.extname(absolutePath);
        const languageId = LANGUAGE_EXTENSIONS[ext] ?? "plaintext";

        const version = files[absolutePath];
        if (version !== undefined) {
          logger.info("workspace/didChangeWatchedFiles", { path: absolutePath });
          await connection.sendNotification("workspace/didChangeWatchedFiles", {
            changes: [
              {
                uri: pathToFileURL(absolutePath).href,
                type: 2,
              },
            ],
          });

          const next = version + 1;
          files[absolutePath] = next;
          logger.info("textDocument/didChange", { path: absolutePath, version: next });
          await connection.sendNotification("textDocument/didChange", {
            textDocument: {
              uri: pathToFileURL(absolutePath).href,
              version: next,
            },
            contentChanges: [{ text }],
          });
          return;
        }

        logger.info("workspace/didChangeWatchedFiles", { path: absolutePath });
        await connection.sendNotification("workspace/didChangeWatchedFiles", {
          changes: [
            {
              uri: pathToFileURL(absolutePath).href,
              type: 1,
            },
          ],
        });

        logger.info("textDocument/didOpen", { path: absolutePath });
        diagnostics.delete(absolutePath);
        await connection.sendNotification("textDocument/didOpen", {
          textDocument: {
            uri: pathToFileURL(absolutePath).href,
            languageId,
            version: 0,
            text,
          },
        });
        files[absolutePath] = 0;
      },
      async waitForDiagnostics(filePath: string) {
        const absolutePath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(input.root, filePath);

        logger.info("waiting for diagnostics", { path: absolutePath });

        await new Promise<void>(resolve => {
          let done = false;

          const finish = (hasDiagnostics: boolean) => {
            if (done) return;
            done = true;
            clearInterval(interval);
            clearTimeout(timeout);

            if (hasDiagnostics) {
              setTimeout(() => {
                logger.info("got diagnostics", { path: absolutePath });
                resolve();
              }, DIAGNOSTICS_DEBOUNCE_MS);
              return;
            }

            logger.info("diagnostics timeout, continuing", { path: absolutePath });
            resolve();
          };

          const interval = setInterval(() => {
            if (diagnostics.has(absolutePath)) {
              finish(true);
            }
          }, 50);

          const timeout = setTimeout(() => {
            finish(false);
          }, DIAGNOSTICS_WAIT_MS);

          if (diagnostics.has(absolutePath)) {
            finish(true);
          }
        });
      },
      async shutdown() {
        logger.info("shutting down");
        try {
          await connection.sendRequest("shutdown");
          await connection.sendNotification("exit");
        } catch {
          // Ignore shutdown errors
        }
        connection.end();
        connection.dispose();
        input.handle.process.kill();
        logger.info("shutdown complete");
      },
    };
  },
};
