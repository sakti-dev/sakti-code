import { describe, expect, it } from "vite-plus/test";
import { runProcess } from "../spawn.ts";

describe("runProcess", () => {
  it("rejects with a clear engine error when the binary is missing (ENOENT)", async () => {
    const promise = runProcess("/nonexistent/path/rg", ["--version"], { cwd: "." });
    await expect(promise).rejects.toMatchObject({
      name: "EngineBinaryError",
      code: "ENGINE_BINARY_NOT_FOUND",
    });
  });

  it("still resolves {exitCode, stdout, stderr} for a normal exit", async () => {
    const result = await runProcess(process.execPath, ["--version"], { cwd: "." });
    expect(result.exitCode).toBe(0);
    expect(/^v\d/.test(result.stdout)).toBe(true);
  });
});
