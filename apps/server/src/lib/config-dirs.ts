import { homedir } from "node:os";
import { join } from "node:path";

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
