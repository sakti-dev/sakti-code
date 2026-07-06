#!/usr/bin/env node
import { createRequire } from "module";
import { buildSddProgram } from "./sdd/program.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

export const program = buildSddProgram(version);

function runCli(argv: string[] = process.argv): void {
  program.parse(argv);
}

runCli();
