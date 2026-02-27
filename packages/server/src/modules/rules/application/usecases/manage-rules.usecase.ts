import {
  PermissionManager,
  createDefaultRules,
  evaluatePermission,
  formatConfigRules,
  parseConfigRules,
} from "@sakti-code/core/server";

type RuleAction = "allow" | "deny" | "ask";
type RulePermission = "read" | "edit" | "bash" | "external_directory" | "mode_switch";

export interface RuleInput {
  permission: RulePermission;
  pattern: string;
  action: RuleAction;
}

export type RulesConfig = Record<string, RuleAction | Record<string, RuleAction>>;

export function listRulesUsecase() {
  const permissionManager = PermissionManager.getInstance();
  return permissionManager.getRules();
}

export function getRulesConfigUsecase() {
  return formatConfigRules(listRulesUsecase());
}

export function getDefaultRulesUsecase() {
  return createDefaultRules();
}

export function replaceRulesUsecase(rules: RuleInput[]): RuleInput[] {
  const permissionManager = PermissionManager.getInstance();
  permissionManager.setRules(rules);
  return rules;
}

export function addRuleUsecase(rule: RuleInput): RuleInput {
  const permissionManager = PermissionManager.getInstance();
  permissionManager.addRule(rule);
  return rule;
}

export function replaceRulesFromConfigUsecase(config: RulesConfig): RuleInput[] {
  const rules = parseConfigRules(config);
  const permissionManager = PermissionManager.getInstance();
  permissionManager.setRules(rules);
  return rules as RuleInput[];
}

export function resetRulesUsecase(): RuleInput[] {
  const defaultRules = createDefaultRules();
  const permissionManager = PermissionManager.getInstance();
  permissionManager.setRules(defaultRules);
  return defaultRules as RuleInput[];
}

export function clearRulesUsecase(): RuleInput[] {
  const permissionManager = PermissionManager.getInstance();
  permissionManager.clearRules();
  return [];
}

export function evaluateRuleUsecase(input: { permission: RulePermission; pattern: string }) {
  const rules = listRulesUsecase();
  return evaluatePermission(input.permission, input.pattern, rules);
}
