import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Returns the agent config directory. Defaults to `~/.sakti/agent` (pi-style),
 * overridable via the `SAKTI_AGENT_DIR` environment variable.
 */
export function getAgentDir(): string {
  const override = process.env.SAKTI_AGENT_DIR;
  if (override) {
    return override;
  }
  return join(homedir(), ".sakti", "agent");
}

/**
 * Project-local config directory name. Cross-agent convention (`.agents/` is
 * honored by opencode as an external source, and `AGENTS.md` is the shared
 * standard), so other tools publishing under `.agents/` are readable by sakti.
 */
const PROJECT_CONFIG_DIR = ".agents";

/**
 * Enumerate the config directories to scan for commands/agents/skills for a
 * given project: the global agent dir (`~/.sakti/agent`, overridable via
 * `SAKTI_AGENT_DIR`) followed by the project's `<cwd>/.agents` dir. Results are
 * deduped (order-preserving) so a `SAKTI_AGENT_DIR` pointing at the project's
 * `.agents` doesn't double-scan.
 *
 * The walk-up-to-worktree behaviour opencode performs is deliberately deferred
 * (YAGNI) — `projectCwd` is the single project scan point until monorepo
 * support is needed.
 */
export function enumerateAgentConfigDirs(projectCwd: string): string[] {
  const dirs = [getAgentDir(), join(projectCwd, PROJECT_CONFIG_DIR)];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const dir of dirs) {
    if (seen.has(dir)) {
      continue;
    }
    seen.add(dir);
    unique.push(dir);
  }
  return unique;
}

/**
 * Returns the log directory. Defaults to `~/.sakti/logs` — a sibling of the
 * agent dir so logs live alongside the rest of sakti state (not under
 * `~/.config`). Overridable via `SAKTI_LOG_DIR`; when `SAKTI_AGENT_DIR` is set,
 * logs move to its sibling too (`<parent>/logs`).
 */
export function getLogDir(): string {
  const override = process.env.SAKTI_LOG_DIR;
  if (override) {
    return override;
  }
  return join(dirname(getAgentDir()), "logs");
}

export function getAuthPath(): string {
  return join(getAgentDir(), "auth.json");
}

export function getProfilesPath(): string {
  return join(getAgentDir(), "profiles.json");
}

export function getSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

export function getMigratedSentinelPath(): string {
  return join(getAgentDir(), ".migrated");
}
