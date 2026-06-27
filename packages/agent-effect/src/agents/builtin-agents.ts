import type { AgentDefinition } from "~/harness-types";
import {
  BUILD_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  EXPLORE_PROMPT,
  GENERAL_PROMPT,
  PLAN_PROMPT,
} from "~/prompts/agents";
import { fromConfig, type PermissionRuleset } from "./permission.ts";

/**
 * Builtin switchable agents. Ruleset values are ported from opencode's
 * `agent/agent.ts:140-265` (the `defaults` base at `:119-135` plus each agent's
 * `fromConfig` overlay), adapted to sakti's flat `PermissionRuleset` engine.
 *
 * Differences from opencode:
 * - `.env` reads are `"ask"` (interactive approval channel wired in Phase 4);
 *   `.env.example` is explicitly `"allow"` as a non-secret template.
 * - opencode merges a large `defaults` ruleset (doom_loop/question/plan_*);
 *   sakti's tool surface doesn't include those permissions yet, so each agent
 *   declares a self-contained ruleset.
 */

export { DEFAULT_SYSTEM_PROMPT };

/** Allow everything (the base for build/general). */
function allowAllRuleset(): PermissionRuleset {
  return fromConfig({ "*": "allow" });
}

/** Allow everything but ask before reading secret env files (`.env.example` is fine) or touching external dirs. */
function buildRuleset(): PermissionRuleset {
  return fromConfig({
    "*": "allow",
    external_directory: { "*": "ask" },
    read: {
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow",
    },
  });
}

/** Read-only: deny everything except the read/search/list/safe-bash permissions. */
function exploreRuleset(): PermissionRuleset {
  return fromConfig({
    "*": "deny",
    read: "allow",
    grep: "allow",
    glob: "allow",
    list: "allow",
    bash: "allow",
  });
}

/** Plan: allow-all minus edits. */
function planRuleset(): PermissionRuleset {
  return fromConfig({
    "*": "allow",
    edit: { "*": "deny" },
  });
}

/** Builtins, ordered with the default (`build`) first. */
export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    name: "build",
    mode: "primary",
    description:
      "The default agent. Executes tools based on configured permissions.",
    systemPrompt: BUILD_PROMPT,
    permission: buildRuleset(),
  },
  {
    name: "explore",
    mode: "subagent",
    description:
      "Fast read-only agent specialized for exploring codebases: find files by pattern, search code for keywords, answer questions about the codebase.",
    systemPrompt: EXPLORE_PROMPT,
    permission: exploreRuleset(),
  },
  {
    name: "plan",
    mode: "primary",
    description:
      "Plan mode. Researches the codebase and produces a plan; disallows all edit tools.",
    systemPrompt: PLAN_PROMPT,
    permission: planRuleset(),
  },
  {
    name: "general",
    mode: "subagent",
    description:
      "General-purpose agent for researching complex questions and executing multi-step tasks.",
    systemPrompt: GENERAL_PROMPT,
    permission: allowAllRuleset(),
  },
];

/** Resolve a builtin agent by name. */
export function resolveBuiltinAgent(name: string): AgentDefinition | undefined {
  return BUILTIN_AGENTS.find((agent) => agent.name === name);
}

export const DEFAULT_AGENT_NAME = "build";
