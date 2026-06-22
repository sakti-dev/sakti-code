import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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

  const db = await initDatabase(new Database(dbPath), {
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
  const server = serve({
    fetch: app.fetch,
    hostname,
    port,
    websocket: { server: wss as unknown as WebSocketServerLike },
  });

  const address = server.address();
  const info =
    typeof address === "object" && address !== null
      ? address
      : { port, address: hostname };
  const actualPort = info.port ?? port;
  const actualHostname =
    "address" in info ? (info.address as string) : hostname;

  return {
    hostname: actualHostname,
    port: actualPort,
    url: `http://${actualHostname}:${actualPort}`,
    stop: () =>
      new Promise<void>((resolveStop) => {
        server.close(() => resolveStop());
      }),
  };
}
