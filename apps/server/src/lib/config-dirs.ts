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
