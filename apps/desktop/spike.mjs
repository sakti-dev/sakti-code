// §1 spike: verify node:sqlite + embedded createServer run under ELECTRON's bundled Node.
// Headless (no window). Run: bun run --filter desktop spike   (or)  electron apps/desktop/spike.mjs

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "@sakti-code/server/create-server";
import { app } from "electron";

const log = (...a) => console.log("[spike]", ...a);

app.disableHardwareAcceleration(); // headless: no GPU needed, silences EGL noise

async function main() {
  // 1. node:sqlite :memory: smoke
  const mem = new DatabaseSync(":memory:");
  mem.exec("create table t(x)");
  mem.prepare("insert into t values (42)").run();
  const row = mem.prepare("select x from t").get();
  mem.close();
  log("node:sqlite memory OK:", JSON.stringify(row));

  // 2. embedded server on an ephemeral port, real file DB in a temp dir
  const dir = mkdtempSync(join(tmpdir(), "sakti-spike-"));
  const server = await createServer({
    port: 0,
    hostname: "127.0.0.1",
    dbPath: join(dir, "spike.db"),
  });
  log("createServer OK, url:", server.url);

  // 3. /api/health over real HTTP (mounted under /api — see apps/server/src/app.ts)
  const health = await fetch(`${server.url}/api/health`).then((r) => r.json());
  log("/health:", JSON.stringify(health));

  // 4. graceful stop (port release)
  await server.stop();
  log("server.stop() OK");

  log("SPIKE PASSED");
  app.quit();
}

app
  .whenReady()
  .then(main)
  .catch((e) => {
    console.error("[spike] FAILED:", e);
    process.exit(1);
  });
