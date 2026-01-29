/**
 * Discovery Tools for the Discovery & Research Agent (DRA)
 *
 * Provides tools for finding repositories and resolving versions without hard-coding rules.
 * Supports 4-tier discovery: registry → heuristic → import_map → web_search (future).
 */

import { tool, zodSchema } from "ai";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { getGitManager } from "./git-manager";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type PackageRegistryEntry = {
  url: string;
  searchPath?: string;
  tagPrefix?: string;
  language: string;
  isMonorepo: boolean;
};

type RegistryLookupInput = {
  packageName: string;
};

export type RegistryLookupOutput = {
  found: boolean;
  url?: string;
  searchPath?: string;
  tagPrefix?: string;
  language?: string;
  isMonorepo?: boolean;
};

type GitProbeInput = {
  url: string;
};

export type GitProbeResult = {
  valid: boolean;
  url: string;
  tags: string[];
  branches: string[];
  error?: {
    code: string;
    message: string;
  };
};

type GitCloneInput = {
  url: string;
  version: string;
  searchPath?: string;
};

export type GitCloneOutput = {
  success: boolean;
  path?: string;
  ref?: string;
  commit?: string;
  error?: {
    code: string;
    message: string;
    hint?: string;
  };
};

export type ImportMapConfig = {
  imports?: Record<string, string>;
  overrides?: Record<
    string,
    {
      url: string;
      strategy?: "monorepo" | "single";
      tagPrefix?: string;
      searchPath?: string;
    }
  >;
  aliases?: Record<
    string,
    {
      url: string;
      tag?: string;
      branch?: string;
      commit?: string;
      searchPath?: string;
    }
  >;
};

type ImportMapLookupInput = {
  packageName: string;
};

export type ImportMapLookupOutput = {
  found: boolean;
  url?: string;
  tag?: string;
  branch?: string;
  commit?: string;
  searchPath?: string;
  tagPrefix?: string;
};

// ============================================================================
// PACKAGE REGISTRY (Tier 1 Discovery)
// ============================================================================

const PACKAGE_REGISTRY = new Map<string, PackageRegistryEntry>([
  [
    "ai",
    {
      url: "https://github.com/vercel/ai",
      searchPath: "packages/ai",
      tagPrefix: "packages/ai@",
      language: "typescript",
      isMonorepo: true,
    },
  ],
  [
    "@ai-sdk/zai",
    {
      url: "https://github.com/vercel/ai",
      searchPath: "packages/zai",
      tagPrefix: "packages/zai@",
      language: "typescript",
      isMonorepo: true,
    },
  ],
  [
    "@ai-sdk/openai",
    {
      url: "https://github.com/vercel/ai",
      searchPath: "packages/openai",
      tagPrefix: "packages/openai@",
      language: "typescript",
      isMonorepo: true,
    },
  ],
  [
    "xstate",
    { url: "https://github.com/statelyai/xstate", language: "typescript", isMonorepo: false },
  ],
  [
    "zustand",
    { url: "https://github.com/pmndrs/zustand", language: "typescript", isMonorepo: false },
  ],
  ["redux", { url: "https://github.com/reduxjs/redux", language: "typescript", isMonorepo: true }],
  [
    "react",
    {
      url: "https://github.com/facebook/react",
      searchPath: "packages/react",
      language: "typescript",
      isMonorepo: true,
    },
  ],
  ["vue", { url: "https://github.com/vuejs/core", language: "typescript", isMonorepo: false }],
  [
    "svelte",
    { url: "https://github.com/sveltejs/svelte", language: "typescript", isMonorepo: false },
  ],
  ["solid", { url: "https://github.com/solidjs/solid", language: "typescript", isMonorepo: true }],
  ["vite", { url: "https://github.com/vitejs/vite", language: "typescript", isMonorepo: true }],
  [
    "webpack",
    { url: "https://github.com/webpack/webpack", language: "typescript", isMonorepo: true },
  ],
  ["esbuild", { url: "https://github.com/evanw/esbuild", language: "go", isMonorepo: false }],
  [
    "vitest",
    { url: "https://github.com/vitest-dev/vitest", language: "typescript", isMonorepo: true },
  ],
  ["jest", { url: "https://github.com/jestjs/jest", language: "typescript", isMonorepo: true }],
]);

/**
 * Registry lookup tool
 */
export const createRegistryLookupTool = () =>
  tool<RegistryLookupInput, RegistryLookupOutput>({
    description: "Lookup a package in the pre-configured registry.",
    inputSchema: zodSchema(z.object({ packageName: z.string() })),
    outputSchema: zodSchema(
      z.object({
        found: z.boolean(),
        url: z.string().optional(),
        searchPath: z.string().optional(),
        tagPrefix: z.string().optional(),
        language: z.string().optional(),
        isMonorepo: z.boolean().optional(),
      })
    ),
    execute: async ({ packageName }) => {
      const result = PACKAGE_REGISTRY.get(packageName);
      if (!result) return { found: false };
      return { found: true, ...result };
    },
  });

export const registryLookup = createRegistryLookupTool();

// ============================================================================
// GIT PROBE (Tier 2 Discovery)
// ============================================================================

function execGitLsRemote(args: string[]): string {
  return execSync("git " + args.join(" "), { encoding: "utf-8", stdio: "pipe", timeout: 10000 });
}

/**
 * Git probe tool
 */
export const createGitProbeTool = () =>
  tool<GitProbeInput, GitProbeResult>({
    description: "Validate a git repository URL and fetch available tags/branches.",
    inputSchema: zodSchema(z.object({ url: z.string() })),
    outputSchema: zodSchema(
      z.object({
        valid: z.boolean(),
        url: z.string(),
        tags: z.array(z.string()),
        branches: z.array(z.string()),
      })
    ),
    execute: async ({ url }) => {
      const gitMgr = getGitManager();
      if (!gitMgr.validateUrl(url)) {
        return { valid: false, url, tags: [], branches: [] };
      }
      const tags = await gitMgr.fetchTags(url);
      let branches: string[] = ["main", "master"];
      try {
        const output = execGitLsRemote(["ls-remote", "--heads", url]);
        branches = output
          .split("\n")
          .filter(line => line.includes("refs/heads/"))
          .map(line => line.split("\t")[1].replace("refs/heads/", ""));
      } catch {}
      return { valid: true, url, tags, branches };
    },
  });

export const gitProbe = createGitProbeTool();

// ============================================================================
// GIT CLONE TOOL
// ============================================================================

/**
 * Git clone tool
 */
export const createGitCloneTool = () =>
  tool<GitCloneInput, GitCloneOutput>({
    description: "Clone a git repository at a specific version (tag/branch).",
    inputSchema: zodSchema(
      z.object({
        url: z.string(),
        version: z.string().default("main"),
        searchPath: z.string().optional(),
      })
    ),
    outputSchema: zodSchema(
      z.object({
        success: z.boolean(),
        path: z.string().optional(),
        ref: z.string().optional(),
        commit: z.string().optional(),
      })
    ),
    execute: async ({ url, version, searchPath }) => {
      const gitMgr = getGitManager();
      const tags = await gitMgr.fetchTags(url);
      const resolvedRef = gitMgr.resolveVersion(version, tags) || version;
      const result = await gitMgr.clone({
        url,
        branch: resolvedRef,
        searchPaths: searchPath ? [searchPath] : [],
        depth: 1,
        quiet: true,
      });
      if (result.success) {
        return { success: true, path: result.path, ref: resolvedRef, commit: result.commit };
      }
      return { success: false };
    },
  });

export const gitClone = createGitCloneTool();

// ============================================================================
// IMPORT MAP LOOKUP (Tier 3 Discovery)
// ============================================================================

const IMPORT_MAP_PATH = path.join(
  process.env.HOME || homedir(),
  ".config",
  "search-docs",
  "import-map.json"
);
let importMapCache: ImportMapConfig | null = null;

function loadImportMap(): ImportMapConfig | null {
  if (importMapCache) return importMapCache;
  try {
    if (existsSync(IMPORT_MAP_PATH)) {
      const content = readFileSync(IMPORT_MAP_PATH, "utf-8");
      importMapCache = JSON.parse(content) as ImportMapConfig;
      return importMapCache;
    }
  } catch {}
  return null;
}

export function resetImportMapCache(): void {
  importMapCache = null;
}

/**
 * Import map lookup tool
 */
export const createImportMapLookupTool = () =>
  tool<ImportMapLookupInput, ImportMapLookupOutput>({
    description: "Lookup a package in the user's import map configuration.",
    inputSchema: zodSchema(z.object({ packageName: z.string() })),
    outputSchema: zodSchema(
      z.object({
        found: z.boolean(),
        url: z.string().optional(),
        tag: z.string().optional(),
        branch: z.string().optional(),
        commit: z.string().optional(),
        searchPath: z.string().optional(),
        tagPrefix: z.string().optional(),
      })
    ),
    execute: async ({ packageName }) => {
      const config = loadImportMap();
      if (!config) return { found: false };
      if (config.aliases?.[packageName]) return { found: true, ...config.aliases[packageName] };
      if (config.overrides?.[packageName])
        return { found: true, url: config.overrides[packageName].url };
      for (const [pattern, url] of Object.entries(config.imports || {})) {
        if (packageName.startsWith(pattern)) return { found: true, url };
      }
      return { found: false };
    },
  });

export const importMapLookup = createImportMapLookupTool();

// ============================================================================
// EXPORTS
// ============================================================================

export const discoveryTools = {
  registryLookup,
  gitProbe,
  gitClone,
  importMapLookup,
};

export function resetDiscoveryTools(): void {
  resetImportMapCache();
}
