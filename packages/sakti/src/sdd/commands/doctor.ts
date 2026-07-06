/**
 * `sakti doctor`: project setup health check.
 *
 * Answers "is this project's .sakti/ setup healthy?" — checks the
 * project config, schema resolvability, and schema structure (YAML
 * parses, templates exist). Read-only; never repairs.
 */
import { Command } from "commander";

import { findRepoPlanningRootSync } from "../core/planning-home.js";
import { readProjectConfig, resolveConfigFilePath } from "../core/project-config.js";
import {
  validateSchema,
  resolveSchemaLocation,
  type SchemaValidationResult,
  type SchemaResolution,
  type ValidationIssue,
} from "../core/artifact-graph/validate.js";
import { listSchemas } from "../core/artifact-graph/resolver.js";

import { printJson } from "./shared-output.js";

interface DoctorFinding {
  level: "ok" | "error" | "warning";
  message: string;
  fix?: string;
}

interface DoctorReport {
  root: {
    path: string;
    found: boolean;
  };
  config: {
    present: boolean;
    valid: boolean;
    schemaName?: string;
    findings: DoctorFinding[];
  };
  schema: {
    resolvable: boolean;
    resolution?: SchemaResolution;
    validation?: SchemaValidationResult;
    findings: DoctorFinding[];
  };
  healthy: boolean;
}

function issueToFinding(issue: ValidationIssue): DoctorFinding {
  const finding: DoctorFinding = { level: issue.level, message: `${issue.path}: ${issue.message}` };
  return finding;
}

function gatherConfigFindings(rootPath: string): {
  present: boolean;
  valid: boolean;
  schemaName?: string;
  findings: DoctorFinding[];
} {
  const findings: DoctorFinding[] = [];
  const configPath = resolveConfigFilePath(rootPath);
  const fileExists = configPath !== null;
  const config = readProjectConfig(rootPath);

  if (!fileExists) {
    findings.push({
      level: "error",
      message: ".sakti/config.yaml is missing",
      fix: "Run `sakti new change` to initialize the project, or create .sakti/config.yaml with at least a `schema:` field.",
    });
    return { present: false, valid: false, findings };
  }

  findings.push({ level: "ok", message: "config.yaml present" });

  if (!config) {
    findings.push({
      level: "error",
      message: "config.yaml exists but could not be parsed (invalid YAML or not an object)",
      fix: "Fix the YAML syntax in .sakti/config.yaml. It must be a YAML object with at least a `schema:` field.",
    });
    return { present: true, valid: false, findings };
  }

  if (!config.schema) {
    findings.push({
      level: "error",
      message: "config.yaml is missing the required `schema` field",
      fix: "Add `schema: spec-driven` to .sakti/config.yaml",
    });
    return { present: true, valid: false, findings };
  }

  findings.push({ level: "ok", message: `schema field set: ${config.schema}` });
  return { present: true, valid: true, schemaName: config.schema, findings };
}

function gatherSchemaFindings(
  schemaName: string,
  projectRoot: string,
): {
  resolvable: boolean;
  resolution?: SchemaResolution;
  validation?: SchemaValidationResult;
  findings: DoctorFinding[];
} {
  const findings: DoctorFinding[] = [];
  const resolution = resolveSchemaLocation(schemaName, projectRoot);

  if (!resolution) {
    const available = listSchemas(projectRoot);
    findings.push({
      level: "error",
      message: `Schema '${schemaName}' not found in any location (project/user/package)`,
      fix:
        available.length > 0
          ? `Available schemas: ${available.join(", ")}. Set one in .sakti/config.yaml.`
          : "No schemas available. The package install may be incomplete.",
    });
    return { resolvable: false, findings };
  }

  findings.push({
    level: "ok",
    message: `resolves from ${resolution.source}: ${resolution.path}`,
  });

  if (resolution.shadows.length > 0) {
    findings.push({
      level: "warning",
      message: `shadows ${resolution.shadows.map((s) => s.source).join(", ")} — the active schema wins`,
    });
  }

  const validation = validateSchema(resolution.path);
  for (const issue of validation.issues) {
    findings.push(issueToFinding(issue));
  }

  if (validation.valid) {
    findings.push({ level: "ok", message: "schema structure and templates valid" });
  }

  return { resolvable: true, resolution, validation, findings };
}

function gatherReport(): DoctorReport {
  const rootPath = findRepoPlanningRootSync(process.cwd());

  if (!rootPath) {
    return {
      root: { path: process.cwd(), found: false },
      config: { present: false, valid: false, findings: [] },
      schema: { resolvable: false, findings: [] },
      healthy: false,
    };
  }

  const configResult = gatherConfigFindings(rootPath);

  let schemaResult: DoctorReport["schema"] = { resolvable: false, findings: [] };
  if (configResult.schemaName) {
    schemaResult = gatherSchemaFindings(configResult.schemaName, rootPath);
  }

  const configHealthy = configResult.findings.every((f) => f.level !== "error");
  const schemaHealthy = schemaResult.findings.every((f) => f.level !== "error");
  const healthy = configHealthy && schemaHealthy;

  return {
    root: { path: rootPath, found: true },
    config: configResult,
    schema: schemaResult,
    healthy,
  };
}

function printFindings(prefix: string, findings: DoctorFinding[]): void {
  for (const finding of findings) {
    if (finding.level === "ok") {
      console.log(`${prefix}- ${finding.message}`);
    } else {
      console.log(`${prefix}- [${finding.level}] ${finding.message}`);
      if (finding.fix) {
        console.log(`${prefix}  Fix: ${finding.fix}`);
      }
    }
  }
}

function printHumanReport(report: DoctorReport): void {
  console.log("Doctor");
  console.log("");

  if (!report.root.found) {
    console.log("Root");
    console.log("  [error] No .sakti/ directory found from the current location");
    console.log(
      "  Fix: Run this command from inside a Sakti project, or run `sakti new change` to initialize one.",
    );
    return;
  }

  console.log("Root");
  console.log(`  Location: ${report.root.path}`);
  console.log("");

  console.log("Config");
  if (report.config.findings.length === 0) {
    console.log("  (no checks ran)");
  } else {
    printFindings("  ", report.config.findings);
  }
  console.log("");

  console.log("Schema");
  if (report.schema.findings.length === 0) {
    console.log("  (skipped — config has no schema name)");
  } else {
    printFindings("  ", report.schema.findings);
  }

  console.log("");
  console.log(report.healthy ? "Result: healthy" : "Result: issues found (see above)");
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check project setup health: config validity + schema resolvability")
    .option("--json", "Output as JSON")
    .action((options: { json?: boolean }) => {
      const report = gatherReport();
      if (options.json) {
        printJson(report);
      } else {
        printHumanReport(report);
      }
      if (!report.healthy) {
        process.exitCode = 1;
      }
    });
}
