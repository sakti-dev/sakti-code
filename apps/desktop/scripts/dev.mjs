// Dev launcher: runs `electron-vite dev` with Wayland flags passed as REAL
// command-line args to the Electron binary.
//
// Why: Chromium picks the ozone platform at C++ init — before our main entry's
// `app.commandLine.appendSwitch` runs, so appendSwitch can't force Wayland.
// electron-vite reads ELECTRON_CLI_ARGS (JSON array) and forwards it to the
// Electron binary (see openspec/references/electron-vite/src/electron.ts).
// We set it here in-process so turbo's env handling can't strip it.
import { spawn } from "node:child_process";

if (process.platform === "linux") {
  process.env.ELECTRON_CLI_ARGS = JSON.stringify([
    "--ozone-platform=wayland",
    "--enable-features=WaylandFractionalScaleV1",
  ]);
}

const ps = spawn("electron-vite", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
});

ps.on("exit", (code) => process.exit(code ?? 0));
