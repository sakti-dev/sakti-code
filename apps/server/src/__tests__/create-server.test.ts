import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createServer } from "../create-server.ts";

let staticDir: string;
let skillsRuntimeDir: string;
let origAgentDir: string | undefined;

beforeAll(() => {
  staticDir = mkdtempSync(join(tmpdir(), "sakti-static-"));
  // Redirect builtin-skill install away from the real ~/.sakti/agent so
  // createServer's install-at-boot step writes to a throwaway temp dir.
  origAgentDir = process.env.SAKTI_AGENT_DIR;
  skillsRuntimeDir = mkdtempSync(join(tmpdir(), "sakti-create-server-agent-"));
  process.env.SAKTI_AGENT_DIR = skillsRuntimeDir;
  writeFileSync(
    join(staticDir, "index.html"),
    '<!DOCTYPE html><html><body><div id="app"></div></body></html>',
  );
  writeFileSync(join(staticDir, "test.txt"), "hello world");
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "assets", "app.js"), "console.log('app');");
});

afterAll(() => {
  rmSync(staticDir, { recursive: true, force: true });
  rmSync(skillsRuntimeDir, { recursive: true, force: true });
  if (origAgentDir === undefined) {
    delete process.env.SAKTI_AGENT_DIR;
  } else {
    process.env.SAKTI_AGENT_DIR = origAgentDir;
  }
});

describe("createServer", () => {
  it("starts on a random port and responds to /api/health", async () => {
    const server = await createServer({ port: 0, dbPath: ":memory:" });
    try {
      const res = await fetch(`${server.url}/api/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(server.port).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });

  it("serves index.html at root when staticDir is set", async () => {
    const server = await createServer({
      port: 0,
      dbPath: ":memory:",
      staticDir,
    });
    try {
      const res = await fetch(`${server.url}/`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('<div id="app">');
    } finally {
      await server.stop();
    }
  });

  it("serves static files with correct content from staticDir", async () => {
    const server = await createServer({
      port: 0,
      dbPath: ":memory:",
      staticDir,
    });
    try {
      const txtRes = await fetch(`${server.url}/test.txt`);
      expect(txtRes.status).toBe(200);
      expect(await txtRes.text()).toBe("hello world");

      const jsRes = await fetch(`${server.url}/assets/app.js`);
      expect(jsRes.status).toBe(200);
      expect(jsRes.headers.get("content-type")).toContain("javascript");
    } finally {
      await server.stop();
    }
  });

  it("falls back to index.html for unknown SPA routes", async () => {
    const server = await createServer({
      port: 0,
      dbPath: ":memory:",
      staticDir,
    });
    try {
      const res = await fetch(`${server.url}/some/spa/route`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('<div id="app">');
    } finally {
      await server.stop();
    }
  });

  it("falls back to index.html when requesting a directory", async () => {
    const server = await createServer({
      port: 0,
      dbPath: ":memory:",
      staticDir,
    });
    try {
      const res = await fetch(`${server.url}/assets`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('<div id="app">');
    } finally {
      await server.stop();
    }
  });

  it("blocks path traversal attempts", async () => {
    const server = await createServer({
      port: 0,
      dbPath: ":memory:",
      staticDir,
    });
    try {
      const res = await fetch(`${server.url}/../../../etc/passwd`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain("root:");
    } finally {
      await server.stop();
    }
  });

  it("stop() closes the server", async () => {
    const server = await createServer({ port: 0, dbPath: ":memory:" });
    await server.stop();
    await expect(fetch(`${server.url}/api/health`)).rejects.toThrow();
  });
});
