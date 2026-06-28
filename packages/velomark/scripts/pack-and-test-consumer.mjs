import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const consumerRoot = path.join(repoRoot, "test-consumer");
const vendorRoot = path.join(consumerRoot, "vendor");
const consumerManifestPath = path.join(consumerRoot, "package.json");
const consumerLockfilePath = path.join(consumerRoot, "pnpm-lock.yaml");

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    env: {
      ...process.env,
      CI: "true",
      npm_config_ignore_workspace: "true",
    },
    stdio: "inherit",
  });
}

rmSync(vendorRoot, { force: true, recursive: true });
mkdirSync(vendorRoot, { recursive: true });

const originalManifest = readFileSync(consumerManifestPath, "utf8");
const originalLockfile = existsSync(consumerLockfilePath)
  ? readFileSync(consumerLockfilePath, "utf8")
  : null;

try {
  run("pnpm", ["run", "build"], repoRoot);
  run("pnpm", ["pack", "--pack-destination", vendorRoot], repoRoot);

  const tarballName = readdirSync(vendorRoot).find((entry) =>
    entry.endsWith(".tgz")
  );
  if (!tarballName) {
    throw new Error(`Expected a packed tarball in ${vendorRoot}`);
  }

  const consumerManifest = JSON.parse(originalManifest);
  consumerManifest.dependencies = {
    ...consumerManifest.dependencies,
    velomark: `file:./vendor/${tarballName}`,
  };
  writeFileSync(
    consumerManifestPath,
    `${JSON.stringify(consumerManifest, null, 2)}\n`
  );

  run(
    "pnpm",
    ["install", "--ignore-workspace", "--no-frozen-lockfile"],
    consumerRoot
  );
  run("pnpm", ["run", "build"], consumerRoot);
  run("node", ["smoke.mjs"], consumerRoot);
} finally {
  writeFileSync(consumerManifestPath, originalManifest);
  if (originalLockfile === null) {
    rmSync(consumerLockfilePath, { force: true });
  } else {
    writeFileSync(consumerLockfilePath, originalLockfile);
  }
}

const builtHtmlPath = path.join(consumerRoot, "dist", "index.html");
if (!existsSync(builtHtmlPath)) {
  throw new Error(`Expected consumer build output at ${builtHtmlPath}`);
}
