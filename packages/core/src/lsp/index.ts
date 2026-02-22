export * from "./client";
export * from "./language";
export * from "./server";
export * from "./types";

import { createLogger } from "@sakti-code/shared/logger";
import path from "node:path";
import { LSPClient, type LSPClientInstance } from "./client";
import { LSPServerRegistry, type LSPServerDefinition } from "./server";
import type { LSPDiagnostic } from "./types";

const logger = createLogger("sakti-code:lsp");

export interface LSPStatus {
  id: string;
  name: string;
  root: string;
  status: "connected" | "disconnected";
}

interface ActiveClient {
  client: LSPClientInstance;
  serverId: string;
  rootPath: string;
}

const activeClients = new Map<string, ActiveClient>();
const spawningClients = new Map<string, Promise<LSPClientInstance | undefined>>();

function getClientKey(rootPath: string, serverId: string): string {
  return `${rootPath}:${serverId}`;
}

async function findProjectRoot(filePath: string): Promise<string | undefined> {
  return LSPServerRegistry.findRoot(filePath);
}

export const LSP = {
  async touchFile(filePath: string, waitForDiagnostics?: boolean): Promise<void> {
    logger.info("touchFile", { filePath, waitForDiagnostics });

    const server = await LSPServerRegistry.detectServer(filePath);
    if (!server) {
      logger.info("no LSP server for file", { filePath });
      return;
    }

    const rootPath = await findProjectRoot(filePath);
    if (!rootPath) {
      logger.warn("no project root found", { filePath });
      return;
    }

    const clientKey = getClientKey(rootPath, server.id);

    let client = activeClients.get(clientKey)?.client;

    if (!client) {
      const existingPromise = spawningClients.get(clientKey);
      if (existingPromise) {
        client = (await existingPromise) ?? undefined;
      } else {
        const spawnPromise = LSP.spawnClient(server, rootPath, clientKey);
        spawningClients.set(clientKey, spawnPromise);
        try {
          client = (await spawnPromise) ?? undefined;
        } finally {
          spawningClients.delete(clientKey);
        }
      }
    }

    if (!client) {
      logger.warn("failed to get or create LSP client", { filePath, serverId: server.id });
      return;
    }

    await client.notifyOpen(filePath);

    if (waitForDiagnostics) {
      await client.waitForDiagnostics(filePath);
    }
  },

  async spawnClient(
    server: LSPServerDefinition,
    rootPath: string,
    clientKey: string
  ): Promise<LSPClientInstance | undefined> {
    logger.info("spawning LSP client", { rootPath, serverId: server.id });

    const handle = await server.spawn(rootPath);
    if (!handle) {
      logger.warn("failed to spawn LSP server", { rootPath, serverId: server.id });
      return undefined;
    }

    let client: LSPClientInstance | undefined;
    try {
      client = await LSPClient.create({
        serverId: server.id,
        handle,
        root: rootPath,
      });

      activeClients.set(clientKey, {
        client,
        serverId: server.id,
        rootPath,
      });

      logger.info("LSP client spawned and connected", {
        rootPath,
        serverId: server.id,
        clientKey,
      });
    } catch (_err) {
      logger.error("failed to create LSP client");
      handle.process.kill();
      return undefined;
    }

    return client;
  },

  getDiagnostics(): Record<string, LSPDiagnostic[]> {
    const result: Record<string, LSPDiagnostic[]> = {};

    for (const [_key, activeClient] of activeClients) {
      const diagnostics = activeClient.client.diagnostics;
      for (const [filePath, diags] of diagnostics) {
        if (diags.length > 0) {
          if (!result[filePath]) {
            result[filePath] = [];
          }
          result[filePath].push(...diags);
        }
      }
    }

    return result;
  },

  getStatus(): LSPStatus[] {
    const statuses: LSPStatus[] = [];

    for (const [_key, activeClient] of activeClients) {
      statuses.push({
        id: activeClient.serverId,
        name: LSPServerRegistry.getServer(activeClient.serverId)?.name || activeClient.serverId,
        root: activeClient.rootPath,
        status: "connected",
      });
    }

    return statuses;
  },

  registerClient(key: string, serverId: string, rootPath: string): void {
    logger.info("registerClient (deprecated)", { key, serverId, rootPath });
  },

  unregisterClient(key: string): void {
    logger.info("unregisterClient (deprecated)", { key });
  },

  async shutdown(): Promise<void> {
    logger.info("shutting down all LSP clients");

    const shutdownPromises: Promise<void>[] = [];

    for (const [_key, activeClient] of activeClients) {
      shutdownPromises.push(
        activeClient.client.shutdown().catch(() => {
          logger.error("error shutting down client");
        })
      );
      activeClients.delete(_key);
    }

    await Promise.all(shutdownPromises);
    logger.info("all LSP clients shut down");
  },

  hasActiveClient(filePath: string): boolean {
    const normalizedFilePath = path.resolve(filePath);

    for (const [, activeClient] of activeClients) {
      const rootPath = path.resolve(activeClient.rootPath);
      if (
        normalizedFilePath === rootPath ||
        normalizedFilePath.startsWith(`${rootPath}${path.sep}`)
      ) {
        return true;
      }
    }

    return false;
  },
};
