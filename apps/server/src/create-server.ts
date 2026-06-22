import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve, type WebSocketServerLike } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { initDatabase } from "@sakti-code/db";
import { WebSocketServer } from "ws";
import { buildApp } from "./app.ts";
import { createContext } from "./context.ts";
import { createApiKeyStore } from "./lib/api-key-store.ts";

export interface ServerHooks {
  onOpenFolderDialog?: () => Promise<string | null>;
}

export interface CreateServerOptions {
  dbPath?: string;
  hooks?: ServerHooks;
  hostname?: string;
  migrationsFolder?: string;
  port?: number;
  staticDir?: string | null;
}

export interface SaktiServer {
  hostname: string;
  port: number;
  stop(): Promise<void>;
  url: string;
}

export async function createServer(
  options?: CreateServerOptions
): Promise<SaktiServer> {
  const {
    port = Number(process.env.SAKTI_PORT ?? 3001),
    hostname = process.env.SAKTI_HOST ?? "localhost",
    dbPath = process.env.SAKTI_DB_PATH ?? "sakti-code.db",
    staticDir = null,
    hooks = {},
    migrationsFolder,
  } = options ?? {};

  const db = await initDatabase(new DatabaseSync(dbPath), {
    ...(migrationsFolder === undefined ? {} : { migrationsFolder }),
  });
  const apiKeys = createApiKeyStore(process.env.SAKTI_KEYS_PATH ?? undefined);
  apiKeys.loadIntoEnv();
  const ctx = createContext(db, hooks, apiKeys);

  const app = buildApp(ctx);

  if (staticDir) {
    const staticRoot = resolve(staticDir);
    const indexHtml = join(staticRoot, "index.html");
    app.use("/*", serveStatic({ root: staticRoot }));
    // SPA fallback: unknown routes serve index.html.
    app.get("*", async (c) => {
      const html = await readFile(indexHtml, "utf8");
      return c.html(html);
    });
  }

  const wss = new WebSocketServer({ noServer: true });

  return await new Promise<SaktiServer>((resolveReady) => {
    const server = serve(
      {
        fetch: app.fetch,
        hostname,
        port,
        websocket: { server: wss as unknown as WebSocketServerLike },
      },
      (info) => {
        // Fires once the OS has bound the socket (port:0 now resolved).
        resolveReady({
          hostname: info.address,
          port: info.port,
          url: `http://${info.address}:${info.port}`,
          stop: () =>
            new Promise<void>((resolveStop) => {
              server.close(() => resolveStop());
            }),
        });
      }
    );
  });
}
