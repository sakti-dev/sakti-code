/**
 * @sakti-code/core server-safe exports
 *
 * Avoids loading heavyweight agent/memory modules (e.g., onnxruntime) when
 * the server only needs Instance/permissions utilities.
 */

export type { InstanceContext } from "./instance/context";
export { Instance } from "./instance/index.ts";
export {
  clone,
  createWorktree,
  detectProject as detectProjectFromPath,
  getVCSInfo as getVcsInfo,
  getWorkspacesDir,
  listLocalBranches,
  listRemoteBranches,
  worktreeExists,
} from "./workspace";

export {
  PermissionDeniedError,
  PermissionManager,
  PermissionRejectedError,
  PermissionTimeoutError,
} from "./security/permission-manager";
export { QuestionManager, QuestionRejectedError } from "./session/question-manager";

export {
  createDefaultRules,
  evaluatePermission,
  formatConfigRules,
  parseConfigRules,
} from "./security/permission-rules";

export { initializePermissionRules } from "./config/permissions";

export {
  clearCorePluginHooks,
  setCorePluginHooks,
  triggerChatHeadersHook,
  triggerChatParamsHook,
} from "./plugin/hooks";
export type { CorePluginHooks } from "./plugin/hooks";
