/**
 * Permission Config System
 * Loads permission rules from config files or environment variables
 * Based on OpenCode's config system
 */

import { createLogger } from "@sakti-code/shared/logger";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { PermissionManager } from "../security/permission-manager";
import type { PermissionConfig } from "../security/permission-rules";
import { createDefaultRules, parseConfigRules } from "../security/permission-rules";

const logger = createLogger("sakti-code");

/**
 * Config file locations to check (in order of priority)
 */
const CONFIG_PATHS = [
  // Current directory
  "./sakti-code.config.json",
  "./.sakti-coderc",
  "./.sakti-coderc.json",

  // Home directory
  join(process.env.HOME || "~", ".sakti-coderc"),
  join(process.env.HOME || "~", ".config", "sakti-code", "config.json"),

  // Project root (if in a git repo)
  join(process.cwd(), ".sakti-code", "config.json"),
];

/**
 * Load permission config from environment variable
 * Format: SAKTI_CODE_PERMISSIONS='{"bash": "ask", "read": "allow"}'
 */
function loadFromEnv(): PermissionConfig | null {
  const envConfig = process.env.SAKTI_CODE_PERMISSIONS;
  if (!envConfig) {
    return null;
  }

  try {
    const config = JSON.parse(envConfig);
    logger.debug("Loaded permission config from environment", {
      module: "config",
    });
    return config;
  } catch (error) {
    logger.warn("Failed to parse SAKTI_CODE_PERMISSIONS environment variable", {
      module: "config",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Load permission config from file
 * Supports JSON and JSONC formats
 */
function loadFromFile(): PermissionConfig | null {
  for (const path of CONFIG_PATHS) {
    try {
      if (!existsSync(path)) {
        continue;
      }

      const content = readFileSync(path, "utf-8");

      // Strip JSONC comments (simple implementation)
      const strippedContent = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

      const config = JSON.parse(strippedContent);

      // Check if config has permissions section
      if (config.permissions) {
        logger.debug("Loaded permission config from file", {
          module: "config",
          path,
        });
        return config.permissions;
      }

      // Otherwise, treat the whole file as permissions config
      logger.debug("Loaded permission config from file (root level)", {
        module: "config",
        path,
      });
      return config;
    } catch (error) {
      logger.warn(`Failed to load config from ${path}`, {
        module: "config",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

/**
 * Load permission config from package.json
 */
function loadFromPackageJson(): PermissionConfig | null {
  const packageJsonPath = join(process.cwd(), "package.json");

  try {
    if (!existsSync(packageJsonPath)) {
      return null;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    if (packageJson["sakti-code"]?.permissions) {
      logger.debug("Loaded permission config from package.json", {
        module: "config",
      });
      return packageJson["sakti-code"].permissions;
    }

    return null;
  } catch {
    logger.debug("No sakti-code permissions found in package.json", {
      module: "config",
    });
    return null;
  }
}

/**
 * Load permission rules from all sources
 * Priority: Env > File > Package.json > Defaults
 */
export function loadPermissionConfig(): PermissionConfig {
  // Try environment variable first
  const envConfig = loadFromEnv();
  if (envConfig) {
    return envConfig;
  }

  // Try file config
  const fileConfig = loadFromFile();
  if (fileConfig) {
    return fileConfig;
  }

  // Try package.json
  const packageConfig = loadFromPackageJson();
  if (packageConfig) {
    return packageConfig;
  }

  // Return empty config (will use defaults)
  logger.debug("No permission config found, using defaults", {
    module: "config",
  });
  return {};
}

/**
 * Initialize permission rules from config
 * This should be called on server startup
 */
export function initializePermissionRules(): void {
  console.log("[initializePermissionRules] Starting permission rules initialization...");

  const permissionMgr = PermissionManager.getInstance();

  const config = loadPermissionConfig();

  if (Object.keys(config).length === 0) {
    // No config found, use defaults
    const defaultRules = createDefaultRules();
    console.log(
      `[initializePermissionRules] Loading ${defaultRules.length} default rules:`,
      defaultRules
    );
    permissionMgr.setRules(defaultRules);
    logger.info("Initialized with default permission rules", {
      module: "config",
      count: defaultRules.length,
    });
    return;
  }

  // Parse and set rules from config
  const rules = parseConfigRules(config);
  console.log(`[initializePermissionRules] Loading ${rules.length} rules from config:`, rules);
  permissionMgr.setRules(rules);
  logger.info("Initialized permission rules from config", {
    module: "config",
    count: rules.length,
  });
}

/**
 * Example config file format:
 *
 * sakti-code.config.json:
 * {
 *   "permissions": {
 *     "read": "allow",
 *     "edit": "ask",
 *     "bash": {
 *       "git*": "allow",
 *       "npm*": "allow",
 *       "*": "ask"
 *     },
 *     "external_directory": "ask"
 *   }
 * }
 *
 * Or in package.json:
 * {
 *   "sakti-code": {
 *     "permissions": {
 *       "read": "allow",
 *       "edit": "ask"
 *     }
 *   }
 * }
 */
