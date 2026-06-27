import { configEntryNameFromPath } from "./config-entry-name.ts";
import {
  type LoaderDiagnostic,
  parseFrontmatter,
  resolveKind,
} from "./loader-shared.ts";
import type { AgentDefinition, AgentMode, ExecutionEnv } from "./types.ts";
import { isFailure } from "./types.ts";

export type AgentDiagnosticCode =
  | "file_info_failed"
  | "list_failed"
  | "read_failed"
  | "parse_failed"
  | "invalid_metadata";

/** Warning produced while loading agent definitions. */
export interface AgentDiagnostic extends LoaderDiagnostic {
  code: AgentDiagnosticCode;
}

interface AgentFrontmatter {
  description?: string;
  hidden?: boolean;
  mode?: string;
  model?: string;
  [key: string]: unknown;
}

const AGENT_PREFIXES = ["agent/", "agents/"];
const VALID_MODES: ReadonlySet<AgentMode> = new Set([
  "primary",
  "subagent",
  "all",
]);

/**
 * Load agent definitions from one or more config directories.
 *
 * Each config directory is scanned for `agent/` and/or `agents/` subtrees (both
 * singular and plural are accepted, matching opencode). Every `.md` file within
 * those subtrees becomes an {@link AgentDefinition}: YAML frontmatter supplies
 * `mode`/`hidden`/`description`/`model`, the markdown body becomes the
 * `systemPrompt`, and the entry name is derived from the path relative to the
 * config directory with the `agent/`/`agents/` prefix and extension stripped.
 * Custom agents without an explicit `mode` default to `"all"` (opencode parity).
 *
 * Ignore files are deliberately not honored. Missing config directories and
 * missing agent subtrees are skipped silently. Read/parse failures are returned
 * as diagnostics, not thrown.
 */
export async function loadAgents(
  env: ExecutionEnv,
  dirs: string | string[]
): Promise<{ agents: AgentDefinition[]; diagnostics: AgentDiagnostic[] }> {
  const agents: AgentDefinition[] = [];
  const diagnostics: AgentDiagnostic[] = [];
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
    const rootInfoResult = await env.fileInfo(dir);
    if (isFailure(rootInfoResult)) {
      if (rootInfoResult.failure.code !== "not_found") {
        diagnostics.push({
          type: "warning",
          code: "file_info_failed",
          message: rootInfoResult.failure.message,
          path: dir,
        });
      }
      continue;
    }
    const rootInfo = rootInfoResult.success;
    if ((await resolveKind(env, rootInfo, diagnostics)) !== "directory") {
      continue;
    }
    const entriesResult = await env.listDir(rootInfo.path);
    if (isFailure(entriesResult)) {
      diagnostics.push({
        type: "warning",
        code: "list_failed",
        message: entriesResult.failure.message,
        path: rootInfo.path,
      });
      continue;
    }
    for (const entry of entriesResult.success.sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (entry.name !== "agent" && entry.name !== "agents") {
        continue;
      }
      const kind = await resolveKind(env, entry, diagnostics);
      if (kind !== "directory") {
        continue;
      }
      await collectAgents(env, entry.path, entry.name, agents, diagnostics);
    }
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { agents, diagnostics };
}

async function collectAgents(
  env: ExecutionEnv,
  dir: string,
  relFromConfig: string,
  agents: AgentDefinition[],
  diagnostics: AgentDiagnostic[]
): Promise<void> {
  const entriesResult = await env.listDir(dir);
  if (isFailure(entriesResult)) {
    diagnostics.push({
      type: "warning",
      code: "list_failed",
      message: entriesResult.failure.message,
      path: dir,
    });
    return;
  }
  for (const entry of entriesResult.success.sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const childRel = `${relFromConfig}/${entry.name}`;
    const kind = await resolveKind(env, entry, diagnostics);
    if (kind === "directory") {
      await collectAgents(env, entry.path, childRel, agents, diagnostics);
      continue;
    }
    if (kind !== "file" || !entry.name.endsWith(".md")) {
      continue;
    }
    const result = await loadAgentFromFile(env, entry.path, childRel);
    if (result.agent) {
      agents.push(result.agent);
    }
    diagnostics.push(...result.diagnostics);
  }
}

async function loadAgentFromFile(
  env: ExecutionEnv,
  filePath: string,
  relFromConfig: string
): Promise<{ agent: AgentDefinition | null; diagnostics: AgentDiagnostic[] }> {
  const diagnostics: AgentDiagnostic[] = [];
  const rawContent = await env.readTextFile(filePath);
  if (isFailure(rawContent)) {
    diagnostics.push({
      type: "warning",
      code: "read_failed",
      message: rawContent.failure.message,
      path: filePath,
    });
    return { agent: null, diagnostics };
  }

  const parsed = parseFrontmatter<AgentFrontmatter>(rawContent.success);
  if (isFailure(parsed)) {
    diagnostics.push({
      type: "warning",
      code: "parse_failed",
      message: parsed.failure.message,
      path: filePath,
    });
    return { agent: null, diagnostics };
  }

  const { frontmatter, body } = parsed.success;
  const name = configEntryNameFromPath(relFromConfig, AGENT_PREFIXES);
  const mode = resolveMode(frontmatter.mode);
  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description
      : undefined;
  const hidden =
    typeof frontmatter.hidden === "boolean" ? frontmatter.hidden : undefined;
  const model = resolveModel(frontmatter.model);

  const agent: AgentDefinition = {
    name,
    mode,
    systemPrompt: body,
    ...(description === undefined ? {} : { description }),
    ...(hidden === undefined ? {} : { hidden }),
    ...(model === undefined ? {} : { model }),
  };
  return { agent, diagnostics };
}

function resolveMode(value: unknown): AgentMode {
  return typeof value === "string" && VALID_MODES.has(value as AgentMode)
    ? (value as AgentMode)
    : "all";
}

function resolveModel(
  value: unknown
): { providerId: string; modelId: string } | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return;
  }
  const slashIndex = value.indexOf("/");
  if (slashIndex === -1) {
    return { providerId: "", modelId: value };
  }
  return {
    providerId: value.slice(0, slashIndex),
    modelId: value.slice(slashIndex + 1),
  };
}
