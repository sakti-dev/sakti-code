import { resolve } from "node:path";

export type LeadingInvocation =
  | { kind: "template"; name: string; args: string }
  | { kind: "skill"; name: string; args: string }
  | { kind: "prompt" };

export interface LoadedResources {
  skills: ReadonlyArray<{ name: string }>;
  templates: ReadonlyArray<{ name: string }>;
}

const SKILL_LEADING = /^skill:([a-z0-9-]+)\s*(.*)$/s;
const TEMPLATE_LEADING = /^\/([^\s/]+)\s*(.*)$/s;

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

export type ReadFile = (absolutePath: string) => Promise<Uint8Array | null>;

const FILE_MAX_BYTES = 65_536;
const FILE_MENTION = /@(\S+)/g;

export async function expandFileMentions(
  text: string,
  cwd: string,
  readFile: ReadFile
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
    const bytes = await readFile(abs);
    if (!bytes) {
      continue;
    }
    const total = bytes.byteLength;
    const slice =
      total > FILE_MAX_BYTES ? bytes.subarray(0, FILE_MAX_BYTES) : bytes;
    const note = total > FILE_MAX_BYTES ? `\n[truncated: ${total} bytes]` : "";
    const inlined = `\n<file path="${token}">\n${new TextDecoder().decode(slice)}${note}\n</file>`;
    out = out.replaceAll(`@${token}`, inlined);
  }
  return out;
}

export type FirstTurnPlan =
  | { kind: "template"; name: string; args: string }
  | { kind: "skill"; name: string; args: string }
  | { kind: "prompt"; text: string };

export async function planFirstTurn(
  message: string,
  loaded: LoadedResources,
  cwd: string,
  readFile: ReadFile
): Promise<FirstTurnPlan> {
  const lead = parseLeadingInvocation(message, loaded);
  if (lead.kind === "template" || lead.kind === "skill") {
    return lead;
  }
  return {
    kind: "prompt",
    text: await expandFileMentions(message, cwd, readFile),
  };
}
