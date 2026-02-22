import { resolveAppPaths } from "@sakti-code/shared/paths";
import fs from "node:fs";
import path from "node:path";

const testHome = path.resolve(process.cwd(), ".sakti-code-test");
process.env.SAKTI_CODE_HOME = testHome;

const paths = resolveAppPaths();

fs.mkdirSync(paths.config, { recursive: true });
fs.mkdirSync(paths.state, { recursive: true });
fs.mkdirSync(paths.db, { recursive: true });
fs.mkdirSync(paths.logs, { recursive: true });
