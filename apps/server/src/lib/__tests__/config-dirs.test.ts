import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  enumerateAgentConfigDirs,
  getAgentDir,
  getAuthPath,
  getMigratedSentinelPath,
  getProfilesPath,
  getSettingsPath,
} from "../config-dirs.ts";

describe("config-dirs", () => {
  const origEnv = process.env.SAKTI_AGENT_DIR;

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.SAKTI_AGENT_DIR;
    } else {
      process.env.SAKTI_AGENT_DIR = origEnv;
    }
  });

  it("default agent dir is ~/.sakti/agent", () => {
    delete process.env.SAKTI_AGENT_DIR;
    expect(getAgentDir()).toBe(join(homedir(), ".sakti", "agent"));
  });

  it("SAKTI_AGENT_DIR overrides the default", () => {
    process.env.SAKTI_AGENT_DIR = "/custom/dir";
    expect(getAgentDir()).toBe("/custom/dir");
  });

  it("per-file path helpers resolve under the agent dir", () => {
    process.env.SAKTI_AGENT_DIR = "/tmp/sakti-test-agent";
    expect(getAuthPath()).toBe("/tmp/sakti-test-agent/auth.json");
    expect(getProfilesPath()).toBe("/tmp/sakti-test-agent/profiles.json");
    expect(getSettingsPath()).toBe("/tmp/sakti-test-agent/settings.json");
    expect(getMigratedSentinelPath()).toBe("/tmp/sakti-test-agent/.migrated");
  });

  describe("enumerateAgentConfigDirs", () => {
    it("returns the global agent dir followed by the project .agents dir", () => {
      delete process.env.SAKTI_AGENT_DIR;
      const dirs = enumerateAgentConfigDirs("/proj");
      expect(dirs).toEqual([
        join(homedir(), ".sakti", "agent"),
        join("/proj", ".agents"),
      ]);
    });

    it("honors SAKTI_AGENT_DIR for the global entry", () => {
      process.env.SAKTI_AGENT_DIR = "/custom/global";
      const dirs = enumerateAgentConfigDirs("/proj");
      expect(dirs).toEqual(["/custom/global", join("/proj", ".agents")]);
    });

    it("dedupes when the global and project dirs resolve to the same path", () => {
      process.env.SAKTI_AGENT_DIR = "/proj/.agents";
      const dirs = enumerateAgentConfigDirs("/proj");
      expect(dirs).toEqual(["/proj/.agents"]);
    });
  });
});
