/**
 * @ekacode/core server-safe exports
 *
 * Avoids loading heavyweight agent/memory modules (e.g., onnxruntime) when
 * the server only needs Instance/permissions utilities.
 */

export type { InstanceContext } from "./instance/context";
export { Instance } from "./instance/index.ts";

export {
  PermissionDeniedError,
  PermissionManager,
  PermissionRejectedError,
  PermissionTimeoutError,
} from "./security/permission-manager";

export {
  createDefaultRules,
  evaluatePermission,
  formatConfigRules,
  parseConfigRules,
} from "./security/permission-rules";

export { initializePermissionRules } from "./config/permissions";
