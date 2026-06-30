import { homedir } from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { scanCommand } from "../command-scan.ts";

describe("scanCommand", () => {
  it("surfaces no external directories for an in-cwd command", () => {
    expect(scanCommand("ls src", "/proj").externalDirectories).toEqual([]);
  });

  it("surfaces an absolute path outside cwd", () => {
    const result = scanCommand("cat /etc/passwd", "/proj");
    expect(result.externalDirectories).toEqual(["/etc/passwd"]);
  });

  it("surfaces a parent-relative traversal outside cwd", () => {
    const result = scanCommand("ls ../sibling", "/proj");
    expect(result.externalDirectories).toEqual(["/sibling"]);
  });

  it("expands ~ to home and surfaces it when outside cwd", () => {
    const result = scanCommand("rm ~/.ssh/id_rsa", "/proj");
    expect(result.externalDirectories).toEqual([`${homedir()}/.ssh/id_rsa`]);
  });

  it("ignores plain tokens that are not paths", () => {
    expect(scanCommand("echo hello world", "/proj").externalDirectories).toEqual([]);
  });

  it("handles quoted path arguments", () => {
    const result = scanCommand('cat "/etc/secret file"', "/proj");
    expect(result.externalDirectories).toEqual(["/etc/secret file"]);
  });
});
