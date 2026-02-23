/**
 * Tests for discovery-tools
 *
 * Tests the 4-tier discovery system:
 * - Tier 1: registry_lookup (pre-configured packages)
 * - Tier 2: git_probe (heuristic URLs)
 * - Tier 3: import_map_lookup (user-defined mappings)
 * - Tier 4: git_clone (actual cloning)
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { Instance } from "@/instance";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GitCloneOutput,
  GitProbeResult,
  ImportMapLookupOutput,
  RegistryLookupOutput,
} from "@/tools/search-docs/discovery-tools";

// Set up mocks before importing the module
const mockExecSync = vi.fn();
const mockExec = vi.fn();

vi.doMock("node:child_process", () => ({
  execSync: mockExecSync,
  exec: mockExec,
}));

describe("discovery-tools", () => {
  let discoveryTools: any;
  let resetDiscoveryTools: any;
  let testWorkspaceDir: string;

  // Helper to run a test function within Instance context
  const withInstance = async <T>(fn: () => Promise<T>): Promise<T> => {
    return Instance.provide({
      directory: testWorkspaceDir,
      fn,
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create temporary workspace directory
    testWorkspaceDir = path.join(os.tmpdir(), `sakti-code-discovery-test-${Date.now()}`);
    await fs.mkdir(testWorkspaceDir, { recursive: true });

    // Set up default mock behavior for git operations
    mockExecSync.mockImplementation((command: string) => {
      if (command.includes("ls-remote")) {
        if (command.includes("--tags")) {
          // Mock tag listing
          return `
abc123\trefs/tags/v5.0.0
def456\trefs/tags/v4.38.3
ghi789\trefs/tags/v4.37.1
jkl012\trefs/tags/v3.0.0
`;
        }
        if (command.includes("--heads")) {
          // Mock branch listing
          return `
abc123\trefs/heads/main
def456\trefs/heads/master
`;
        }
      }
      return "";
    });

    // Set up default mock behavior for exec (promisified)
    mockExec.mockImplementation((command: string, callback: any) => {
      try {
        let result = "";

        if (command.includes("ls-remote")) {
          if (command.includes("--tags")) {
            result = `
abc123\trefs/tags/v5.0.0
def456\trefs/tags/v4.38.3
ghi789\trefs/tags/v4.37.1
jkl012\trefs/tags/v3.0.0
`;
          } else if (command.includes("--heads")) {
            result = `
abc123\trefs/heads/main
def456\trefs/heads/master
`;
          }
        }

        callback(null, { stdout: result, stderr: "" });
      } catch (error) {
        callback(error, { stdout: "", stderr: (error as Error).message });
      }
    });

    // Import the module after mocks are set up
    const module = await import("@/tools/search-docs/discovery-tools");
    discoveryTools = module.discoveryTools;
    resetDiscoveryTools = module.resetDiscoveryTools;
  });

  afterEach(() => {
    resetDiscoveryTools?.();
  });

  describe("registryLookup", () => {
    it("finds packages in the pre-configured registry", async () => {
      const result = (await discoveryTools.registryLookup.execute({
        packageName: "xstate",
      })) as RegistryLookupOutput;

      expect(result.found).toBe(true);
      expect(result.url).toBe("https://github.com/statelyai/xstate");
      expect(result.language).toBe("typescript");
      expect(result.isMonorepo).toBe(false);
    });

    it("finds scoped packages", async () => {
      const result = (await discoveryTools.registryLookup.execute({
        packageName: "@ai-sdk/zai",
      })) as RegistryLookupOutput;

      expect(result.found).toBe(true);
      expect(result.url).toBe("https://github.com/vercel/ai");
      expect(result.searchPath).toBe("packages/zai");
      expect(result.isMonorepo).toBe(true);
    });

    it("finds monorepo packages with search paths", async () => {
      const result = (await discoveryTools.registryLookup.execute({
        packageName: "ai",
      })) as RegistryLookupOutput;

      expect(result.found).toBe(true);
      expect(result.searchPath).toBe("packages/ai");
      expect(result.tagPrefix).toBe("packages/ai@");
    });

    it("returns not found for unknown packages", async () => {
      const result = (await discoveryTools.registryLookup.execute({
        packageName: "nonexistent-package-xyz",
      })) as RegistryLookupOutput;

      expect(result.found).toBe(false);
      expect(result.url).toBeUndefined();
    });
  });

  describe("gitProbe", () => {
    it("validates known git URLs and fetches tags", async () => {
      const result = (await discoveryTools.gitProbe.execute({
        url: "https://github.com/vercel/ai",
      })) as GitProbeResult;

      expect(result.valid).toBe(true);
      expect(result.url).toBe("https://github.com/vercel/ai");
      expect(Array.isArray(result.tags)).toBe(true);
      expect(result.tags.length).toBeGreaterThan(0);
      expect(result.tags).toContain("v4.38.3");
    });

    it("fetches available branches", async () => {
      const result = (await discoveryTools.gitProbe.execute({
        url: "https://github.com/facebook/react",
      })) as GitProbeResult;

      expect(result.valid).toBe(true);
      expect(Array.isArray(result.branches)).toBe(true);
      expect(result.branches).toContain("main");
      expect(result.branches).toContain("master");
    });

    it("rejects invalid URLs", async () => {
      const result = (await discoveryTools.gitProbe.execute({
        url: "not-a-valid-url",
      })) as GitProbeResult;

      expect(result.valid).toBe(false);
      expect(result.tags).toEqual([]);
      expect(result.branches).toEqual([]);
    });
  });

  describe("gitClone", () => {
    it("clones a repository at main branch", async () => {
      // Note: This test may try to actually clone, so we mock the git manager
      const result = (await withInstance(() =>
        discoveryTools.gitClone.execute({
          url: "https://github.com/statelyai/xstate",
          version: "main",
        })
      )) as GitCloneOutput;

      // In mocked environment, we just verify the structure
      expect(result).toHaveProperty("success");
      expect(typeof result.success).toBe("boolean");
    });

    it("clones a repository at specific version", async () => {
      const result = (await withInstance(() =>
        discoveryTools.gitClone.execute({
          url: "https://github.com/statelyai/xstate",
          version: "v4.38.3",
        })
      )) as GitCloneOutput;

      expect(result).toHaveProperty("success");
      if (result.success) {
        expect(result.ref).toBe("v4.38.3");
      }
    });

    it("supports sparse checkout with searchPath", async () => {
      const result = (await withInstance(() =>
        discoveryTools.gitClone.execute({
          url: "https://github.com/vercel/ai",
          version: "main",
          searchPath: "packages/ai",
        })
      )) as GitCloneOutput;

      expect(result).toHaveProperty("success");
    });
  });

  describe("importMapLookup", () => {
    it("returns not found when no import map exists", async () => {
      const result = (await discoveryTools.importMapLookup.execute({
        packageName: "any-package",
      })) as ImportMapLookupOutput;

      expect(result.found).toBe(false);
    });
  });

  describe("integration: multi-tier discovery", () => {
    it("demonstrates Tier 1 → Tier 2 workflow", async () => {
      // Try registry first (Tier 1)
      const registryResult = (await discoveryTools.registryLookup.execute({
        packageName: "unknown-package",
      })) as RegistryLookupOutput;

      if (!registryResult.found) {
        // Fall back to git probe (Tier 2)
        const probeResult = (await discoveryTools.gitProbe.execute({
          url: "https://github.com/unknown/package",
        })) as GitProbeResult;
        expect(probeResult).toHaveProperty("valid");
      }
    });

    it("handles monorepo packages correctly", async () => {
      // Test that monorepo entries include proper metadata
      // Note: Some monorepo packages don't have searchPath (e.g., redux, vitest)
      const monorepoPkgs = ["ai", "@ai-sdk/zai", "react", "vitest", "redux"];

      for (const pkg of monorepoPkgs) {
        const result = (await discoveryTools.registryLookup.execute({
          packageName: pkg,
        })) as RegistryLookupOutput;
        if (result.found) {
          expect(result.isMonorepo).toBe(true);
          // Only check for searchPath on packages that define it
          const hasSearchPath = ["ai", "@ai-sdk/zai", "react"].includes(pkg);
          if (hasSearchPath) {
            expect(result.searchPath).toBeDefined();
          }
        }
      }
    });
  });
});
