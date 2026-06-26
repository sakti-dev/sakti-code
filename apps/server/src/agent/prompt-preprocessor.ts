import type { PromptTemplate, Skill } from "@sakti-code/agent";

export type LeadingInvocation =
  | { kind: "template"; name: string; args: string }
  | { kind: "skill"; name: string; args: string }
  | { kind: "prompt" };

export interface LoadedResources {
  skills: Skill[];
  templates: PromptTemplate[];
}

const SKILL_LEADING = /^skill:([a-z0-9-]+)\s*(.*)$/s;
const TEMPLATE_LEADING = /^\/([^\s/]+)\s*(.*)$/s;

/**
 * Detect a leading `/name [args]` or `skill:name [args]` invocation at the
 * start of the (trimmed) message. Since the `/` trigger fires only at caret 0,
 * these tokens are always leading. Unknown names fall through to `prompt`
 * (so a literal `/foo` that isn't a command just becomes ordinary text).
 */
export function parseLeadingInvocation(
  message: string,
  resources: LoadedResources
): LeadingInvocation {
  const trimmed = message.trimStart();
  const skillMatch = SKILL_LEADING.exec(trimmed);
  if (skillMatch && resources.skills.some((s) => s.name === skillMatch[1])) {
    return { kind: "skill", name: skillMatch[1], args: skillMatch[2] };
  }
  const templateMatch = TEMPLATE_LEADING.exec(trimmed);
  if (
    templateMatch &&
    resources.templates.some((t) => t.name === templateMatch[1])
  ) {
    return { kind: "template", name: templateMatch[1], args: templateMatch[2] };
  }
  return { kind: "prompt" };
}
