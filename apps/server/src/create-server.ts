import { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { initDatabase } from "@sakti-code/db";
import { Elysia } from "elysia";
import { buildApp } from "./app.ts";
import { createContext } from "./context.ts";

const LEADING_SLASHES = /^\/+/;

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
  stop(): void;
  url: string;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function serveStaticFile(staticDir: string, pathname: string): Response {
  const staticRoot = resolve(staticDir);
  const clean = pathname.replace(LEADING_SLASHES, "");
  const resolved = clean
    ? resolve(join(staticRoot, clean))
    : join(staticRoot, "index.html");

  if (resolved !== staticRoot && !resolved.startsWith(`${staticRoot}${sep}`)) {
    return new Response(Bun.file(join(staticRoot, "index.html")));
  }

  const filePath = isFile(resolved) ? resolved : join(staticRoot, "index.html");
  return new Response(Bun.file(filePath));
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

  const db = await initDatabase(new Database(dbPath), { migrationsFolder });
  const ctx = createContext(db, hooks);
  const dir: string | null = staticDir;

  const instance = new Elysia()
    .state("ctx", ctx)
    .use(buildApp(ctx))
    .get("/*", ({ request }) => {
      if (!dir) {
        return new Response("Not Found", { status: 404 });
      }
      return serveStaticFile(dir, new URL(request.url).pathname);
    })
    .compile()
    .listen({ port, hostname });

  const actualPort = instance.server?.port ?? port;
  const actualHostname = instance.server?.hostname ?? hostname;

  return {
    port: actualPort,
    hostname: actualHostname,
    url: `http://${actualHostname}:${actualPort}`,
    stop: () => {
      instance.server?.stop();
    },
  };
}
