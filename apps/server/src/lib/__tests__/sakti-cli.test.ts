import { existsSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildPathWithBinDir, ensureSaktiOnPath, getSaktiBinDir } from "../sakti-cli.ts";

describe("sakti-cli", () => {
  describe("buildPathWithBinDir", () => {
    it("prepends bin dir to PATH", () => {
      expect(buildPathWithBinDir("/foo/bin", "/usr/bin:/bin")).toBe("/foo/bin:/usr/bin:/bin");
    });

    it("does not duplicate if bin dir already on PATH", () => {
      expect(buildPathWithBinDir("/foo/bin", "/foo/bin:/usr/bin")).toBe("/foo/bin:/usr/bin");
    });

    it("handles undefined PATH", () => {
      expect(buildPathWithBinDir("/foo/bin", undefined)).toBe("/foo/bin:");
    });
  });

  describe("getSaktiBinDir", () => {
    it("returns ~/.sakti/bin by default", () => {
      delete process.env.SAKTI_AGENT_DIR;
      const expected = join(join(homedir(), ".sakti"), "bin");
      expect(getSaktiBinDir()).toBe(expected);
    });

    it("honors SAKTI_AGENT_DIR override", () => {
      process.env.SAKTI_AGENT_DIR = "/custom/agent";
      expect(getSaktiBinDir()).toBe("/custom/bin");
      delete process.env.SAKTI_AGENT_DIR;
    });
  });

  describe("ensureSaktiOnPath", () => {
    let tempDir: string;
    let origPath: string | undefined;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "sakti-cli-test-"));
      origPath = process.env.PATH;
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
      if (origPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = origPath;
      }
    });

    it("creates a symlink named 'sakti' pointing to the resolved CLI path", () => {
      const fakeCliPath = join(tempDir, "fake-cli.mjs");
      writeFileSync(fakeCliPath, "#!/usr/bin/env node\n");

      const binDir = join(tempDir, "bin");
      ensureSaktiOnPath({
        resolveCliPath: () => fakeCliPath,
        getBinDir: () => binDir,
      });

      const linkPath = join(binDir, "sakti");
      expect(existsSync(linkPath)).toBe(true);
      expect(readlinkSync(linkPath)).toBe(fakeCliPath);
    });

    it("prepends bin dir to process.env.PATH", () => {
      process.env.PATH = "/usr/bin:/bin";
      const binDir = join(tempDir, "bin");

      ensureSaktiOnPath({
        resolveCliPath: () => join(tempDir, "fake-cli.mjs"),
        getBinDir: () => binDir,
      });

      expect(process.env.PATH).toContain(binDir);
      expect(process.env.PATH?.startsWith(binDir)).toBe(true);
    });

    it("is idempotent — recreates symlink on subsequent calls", () => {
      const fakeCli1 = join(tempDir, "fake-cli-v1.mjs");
      const fakeCli2 = join(tempDir, "fake-cli-v2.mjs");
      writeFileSync(fakeCli1, "#!/usr/bin/env node\n");
      writeFileSync(fakeCli2, "#!/usr/bin/env node\n");

      const binDir = join(tempDir, "bin");

      ensureSaktiOnPath({ resolveCliPath: () => fakeCli1, getBinDir: () => binDir });
      expect(readlinkSync(join(binDir, "sakti"))).toBe(fakeCli1);

      ensureSaktiOnPath({ resolveCliPath: () => fakeCli2, getBinDir: () => binDir });
      expect(readlinkSync(join(binDir, "sakti"))).toBe(fakeCli2);
    });

    it("does nothing if CLI path cannot be resolved", () => {
      process.env.PATH = "/usr/bin";
      ensureSaktiOnPath({
        resolveCliPath: () => {
          throw new Error("not found");
        },
        getBinDir: () => join(tempDir, "bin"),
      });
      expect(process.env.PATH).toBe("/usr/bin");
    });
  });
});
