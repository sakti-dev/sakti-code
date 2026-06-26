export type LeadingInvocation =
  | { kind: "template"; name: string; args: string }
  | { kind: "skill"; name: string; args: string }
  | { kind: "prompt" };

/** Only `name` is read; the full `Skill`/`PromptTemplate` shapes are assignable. */
export interface LoadedResources {
  skills: ReadonlyArray<{ name: string }>;
  templates: ReadonlyArray<{ name: string }>;
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
  const skillName = skillMatch?.[1];
  if (skillName && resources.skills.some((s) => s.name === skillName)) {
    return { kind: "skill", name: skillName, args: skillMatch?.[2] ?? "" };
  }
  const templateMatch = TEMPLATE_LEADING.exec(trimmed);
  const templateName = templateMatch?.[1];
  if (
    templateName &&
    resources.templates.some((t) => t.name === templateName)
  ) {
    return {
      kind: "template",
      name: templateName,
      args: templateMatch?.[2] ?? "",
    };
  }
  return { kind: "prompt" };
}

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const FILE_MAX_BYTES = 65_536;
const FILE_MENTION = /@(\S+)/g;

/**
 * Scan for `@path` tokens anywhere in the text and inline the content of any
 * that resolve to a readable file under `cwd`. Tokens that don't resolve to a
 * file (missing paths, emails, etc.) are left untouched — this keeps emails and
 * ordinary prose intact. Huge files are truncated to FILE_MAX_BYTES.
 */
export async function expandFileMentions(
  text: string,
  cwd: string
): Promise<string> {
  const seen = new Set<string>();
  let out = text;
  for (const match of text.matchAll(FILE_MENTION)) {
    const token = match[1];
    if (token === undefined || seen.has(token)) {
      continue;
    }
    seen.add(token);
    const abs = resolve(cwd, token);
    const buf = await readFile(abs).catch(() => null);
    if (!buf) {
      continue;
    }
    const total = buf.length;
    const slice =
      total > FILE_MAX_BYTES ? buf.subarray(0, FILE_MAX_BYTES) : buf;
    const note = total > FILE_MAX_BYTES ? `\n[truncated: ${total} bytes]` : "";
    const inlined = `\n<file path="${token}">\n${slice.toString("utf8")}${note}\n</file>`;
    out = out.replaceAll(`@${token}`, inlined);
  }
  return out;
}

export type FirstTurnPlan =
  | { kind: "template"; name: string; args: string }
  | { kind: "skill"; name: string; args: string }
  | { kind: "prompt"; text: string };

/**
 * Decide how the first turn runs: a leading `/name` or `skill:name` dispatches
 * to the harness template/skill method; otherwise the message is a prompt with
 * any `@file` mentions expanded. Called once per run before the first turn.
 */
export async function planFirstTurn(
  message: string,
  loaded: LoadedResources,
  cwd: string
): Promise<FirstTurnPlan> {
  const lead = parseLeadingInvocation(message, loaded);
  if (lead.kind === "template" || lead.kind === "skill") {
    return lead;
  }
  return { kind: "prompt", text: await expandFileMentions(message, cwd) };
}
