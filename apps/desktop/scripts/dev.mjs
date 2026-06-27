// Dev launcher: runs `electron-vite dev` with Wayland flags passed as REAL
// command-line args to the Electron binary.
//
// Why: Chromium picks the ozone platform at C++ init — before our main entry's
// `app.commandLine.appendSwitch` runs, so appendSwitch can't force Wayland.
// electron-vite reads ELECTRON_CLI_ARGS (JSON array) and forwards it to the
// Electron binary (see openspec/references/electron-vite/src/electron.ts).
// We set it here in-process so turbo's env handling can't strip it.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Resolve the log dir the same way the server/desktop does:
// SAKTI_LOG_DIR wins, otherwise a sibling of the agent dir (~/.sakti/logs).
function resolveLogDir() {
  if (process.env.SAKTI_LOG_DIR) {
    return process.env.SAKTI_LOG_DIR;
  }
  const agentDir =
    process.env.SAKTI_AGENT_DIR ?? join(homedir(), ".sakti", "agent");
  return join(dirname(agentDir), "logs");
}

// Fast iteration: wipe the per-layer log files so each dev run starts clean
// (pino-roll names them `<layer>.<n>.log`, plus date-rotated variants).
function cleanLogs() {
  const dir = resolveLogDir();
  if (!existsSync(dir)) {
    return;
  }
  let removed = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".log")) {
      continue;
    }
    try {
      rmSync(join(dir, file), { force: true });
      removed += 1;
    } catch {
      // Best-effort — a locked file shouldn't block dev startup.
    }
  }
  if (removed > 0) {
    console.log(`[dev] cleared ${removed} log file(s) in ${dir}`);
  }
}

cleanLogs();

if (process.platform === "linux") {
  process.env.ELECTRON_CLI_ARGS = JSON.stringify([
    "--ozone-platform=wayland",
    "--enable-features=WaylandFractionalScaleV1",
  ]);
}

// Verbose diagnostics for dev: capture the agent/llm request+response traces
// (debug level) and stop pino redacting the resolved API key so the auth.json
// → stream-call chain is verifiable. cleanLogs() wipes these files on each
// launch, so secrets only live on disk for the current session — still, rotate
// the key if you pasted one into auth.json for debugging.
process.env.SAKTI_LOG_LEVEL ??= "debug";
process.env.SAKTI_LOG_SECRETS ??= "true";

const ps = spawn("electron-vite", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
});

ps.on("exit", (code) => process.exit(code ?? 0));
