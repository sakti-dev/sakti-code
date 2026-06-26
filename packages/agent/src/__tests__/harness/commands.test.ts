import { describe, expect, it } from "vitest";
import { loadCommands } from "../../harness/commands.ts";
import { createTempDir } from "./session-test-utils.ts";
import { TestExecutionEnv } from "./test-execution-env.ts";

describe("loadCommands", () => {
  it("loads .md files under command/ and commands/ as prompt templates named by path", async () => {
    const root = createTempDir();
    const env = new TestExecutionEnv(root);
    await env.createDir(".agents/command", { recursive: true });
    await env.createDir(".agents/commands/git", { recursive: true });
    await env.writeFile(
      ".agents/command/commit.md",
      "---\ndescription: git commit and push\n---\ncommit and push"
    );
    await env.writeFile(
      ".agents/commands/git/push.md",
      "---\ndescription: push commits\n---\ngit push"
    );

    const { commands, diagnostics } = await loadCommands(env, [".agents"]);

    expect(diagnostics).toEqual([]);
    expect(commands).toEqual([
      {
        name: "commit",
        description: "git commit and push",
        content: "commit and push",
      },
      {
        name: "git/push",
        description: "push commits",
        content: "git push",
      },
    ]);
  });

  it("returns no commands when no command/ or commands/ subtree exists", async () => {
    const root = createTempDir();
    const env = new TestExecutionEnv(root);
    await env.createDir(".agents/agents", { recursive: true });

    const { commands, diagnostics } = await loadCommands(env, [".agents"]);

    expect(commands).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it("omits description when frontmatter has none", async () => {
    const root = createTempDir();
    const env = new TestExecutionEnv(root);
    await env.createDir(".agents/commands", { recursive: true });
    await env.writeFile(".agents/commands/plain.md", "just a body");

    const { commands } = await loadCommands(env, [".agents"]);

    expect(commands).toEqual([{ name: "plain", content: "just a body" }]);
  });
});
