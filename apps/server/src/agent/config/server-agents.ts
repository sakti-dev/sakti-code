import type { AgentDefinition } from "@sakti-code/agent";
import { defineAgent, fromConfig, type PermissionRuleset } from "@sakti-code/agent";
import { BASE_PROMPT, EXPLORE_PROMPT, GENERAL_PROMPT } from "./prompts.ts";

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
    webfetch: "allow",
    websearch: "allow",
  });
}

function exploreRuleset(): PermissionRuleset {
  return fromConfig({
    "*": "deny",
    read: "allow",
    grep: "allow",
    glob: "allow",
    bash: "allow",
    webfetch: "allow",
    websearch: "allow",
  });
}

/**
 * Verify: read-only review agent. Edit and write are structurally denied so
 * the agent is forced to *report* issues, not silently fix them. This is the
 * structural counterweight to the "compaction-before-verify" bias-reduction
 * move — without it, the agent rationalizes "looks good, let me just fix it."
 */
function verifyRuleset(): PermissionRuleset {
  return fromConfig({
    "*": "allow",
    edit: { "*": "deny" },
    write: { "*": "deny" },
    webfetch: "allow",
    websearch: "allow",
  });
}

/** Plan: allow research + doc-writing; ask before destructive bash. */
function planRuleset(): PermissionRuleset {
  return fromConfig({
    "*": "allow",
    bash: { "rm *": "ask", "git push*": "ask", "git reset --hard*": "ask" },
    webfetch: "allow",
    websearch: "allow",
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
    description: "The default agent. Executes tools based on configured permissions.",
    systemPrompt: BASE_PROMPT,
    permission: buildRuleset(),
    activeToolNames: [
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "webfetch",
      "websearch",
      "ask",
    ],
  }),
  defineAgent({
    name: "explore",
    mode: "subagent",
    description:
      "Fast read-only agent specialized for exploring codebases: find files by pattern, search code for keywords, answer questions about the codebase.",
    systemPrompt: EXPLORE_PROMPT,
    permission: exploreRuleset(),
    activeToolNames: ["read", "grep", "find", "bash", "webfetch", "websearch"],
  }),
  defineAgent({
    name: "verify",
    mode: "primary",
    description:
      "Verification agent. Reviews completed work for bugs, completeness, and coherence. Edit-denied: reports issues, does not fix them.",
    systemPrompt: BASE_PROMPT,
    permission: verifyRuleset(),
    activeToolNames: ["read", "grep", "find", "bash", "webfetch", "websearch", "ask"],
  }),
  defineAgent({
    name: "general",
    mode: "subagent",
    description:
      "General-purpose agent for researching complex questions and executing multi-step tasks.",
    systemPrompt: GENERAL_PROMPT,
    permission: allowAllRuleset(),
    activeToolNames: ["read", "write", "edit", "bash", "grep", "find", "webfetch", "websearch"],
  }),
  defineAgent({
    name: "plan",
    mode: "primary",
    description:
      "PM-style planning agent for scoping work before implementation. Follows the sakti-plan skill for workflow and handoff.",
    systemPrompt: BASE_PROMPT,
    permission: planRuleset(),
    activeToolNames: [
      "read",
      "write",
      "edit",
      "bash",
      "grep",
      "find",
      "ask",
      "webfetch",
      "websearch",
    ],
  }),
];

export function resolveServerAgent(name: string): AgentDefinition | undefined {
  return SERVER_AGENTS.find((agent) => agent.name === name);
}
