import type { AgentDefinition } from "@sakti-code/agent";
import {
  defineAgent,
  fromConfig,
  type PermissionRuleset,
} from "@sakti-code/agent";
import {
  BUILD_PROMPT,
  EXPLORE_PROMPT,
  GENERAL_PROMPT,
  INTAKE_SYSTEM_PROMPT,
  PLAN_PROMPT,
} from "./prompts.ts";

export const DEFAULT_AGENT_NAME = "build";

function allowAllRuleset(): PermissionRuleset {
  return fromConfig({ "*": "allow" });
}

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

function planRuleset(): PermissionRuleset {
  return fromConfig({
    "*": "allow",
    edit: { "*": "deny" },
  });
}

/** Intake: allow research + doc-writing; ask before destructive bash. */
function intakeRuleset(): PermissionRuleset {
  return fromConfig({
    "*": "allow",
    bash: { "rm *": "ask", "git push*": "ask", "git reset --hard*": "ask" },
  });
}

/**
 * Server-defined agent catalog. Each entry is fully self-contained:
 * system prompt + permission ruleset + toolNames. Consumers (the runner)
 * resolve an agent by name (or by session kind + per-session override) and
 * build only the declared tools via {@link buildAgentTools}.
 *
 * Project-level agents (`.sakti/agents/*.md`) merge with this catalog at
 * resolve time; a project agent with the same name overrides the server
 * default.
 */
export const SERVER_AGENTS: AgentDefinition[] = [
  defineAgent({
    name: "build",
    mode: "primary",
    description:
      "The default agent. Executes tools based on configured permissions.",
    systemPrompt: BUILD_PROMPT,
    permission: buildRuleset(),
    activeToolNames: ["read", "write", "edit", "bash", "grep", "find", "ls"],
  }),
  defineAgent({
    name: "explore",
    mode: "subagent",
    description:
      "Fast read-only agent specialized for exploring codebases: find files by pattern, search code for keywords, answer questions about the codebase.",
    systemPrompt: EXPLORE_PROMPT,
    permission: exploreRuleset(),
    activeToolNames: ["read", "grep", "find", "ls", "bash"],
  }),
  defineAgent({
    name: "plan",
    mode: "primary",
    description:
      "Plan mode. Researches the codebase and produces a plan; disallows all edit tools.",
    systemPrompt: PLAN_PROMPT,
    permission: planRuleset(),
    activeToolNames: ["read", "grep", "find", "ls", "bash"],
  }),
  defineAgent({
    name: "general",
    mode: "subagent",
    description:
      "General-purpose agent for researching complex questions and executing multi-step tasks.",
    systemPrompt: GENERAL_PROMPT,
    permission: allowAllRuleset(),
    activeToolNames: ["read", "write", "edit", "bash", "grep", "find", "ls"],
  }),
  defineAgent({
    name: "intake",
    mode: "primary",
    description:
      "PM-style planning agent for scoping work before implementation. Calls propose_session to hand off to a task session.",
    systemPrompt: INTAKE_SYSTEM_PROMPT,
    permission: intakeRuleset(),
    activeToolNames: [
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ls",
      "propose_session",
    ],
  }),
];

export function resolveServerAgent(name: string): AgentDefinition | undefined {
  return SERVER_AGENTS.find((agent) => agent.name === name);
}
