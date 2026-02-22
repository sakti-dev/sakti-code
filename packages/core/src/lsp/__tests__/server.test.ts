import { LSPServerRegistry } from "@/lsp/server";
import { describe, expect, it } from "vitest";

describe("LSPServerRegistry", () => {
  describe("detectServer", () => {
    it("should detect TypeScript server for .ts files", async () => {
      const server = await LSPServerRegistry.detectServer("/project/src/file.ts");
      expect(server).toBeDefined();
    });

    it("should detect Python server for .py files", async () => {
      const server = await LSPServerRegistry.detectServer("/project/main.py");
      expect(server).toBeDefined();
    });

    it("should return undefined for unknown file types", async () => {
      const server = await LSPServerRegistry.detectServer("/project/file.xyz");
      expect(server).toBeUndefined();
    });
  });

  describe("getServer", () => {
    it("should return server by id", () => {
      const server = LSPServerRegistry.getServer("typescript");
      expect(server).toBeDefined();
      expect(server?.id).toBe("typescript");
    });
  });
});
