import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { MarkdownParser } from "../markdown-parser.js";
import {
  findMainSpecStructureIssues,
  stripFencedCodeBlocksPreservingLines,
} from "../spec-structure.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const specsRoot = path.join(projectRoot, ".sakti", "specs");

const PURPOSE_PLACEHOLDER_PATTERN =
  /TBD - created by archiving change .*?\. Update Purpose after archive\./;
const REQUIREMENT_HEADER_PATTERN = /^###\s+Requirement:/gm;

async function getSpecFiles(): Promise<string[]> {
  const entries = await fs.readdir(specsRoot, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const specFile = path.join(specsRoot, entry.name, "spec.md");
    try {
      await fs.access(specFile);
      files.push(specFile);
    } catch {
      // Ignore directories without spec.md
    }
  }

  return files.sort();
}

describe("source-of-truth specs normalization", () => {
  it("enforces required sections and bans hidden requirements, placeholders, and delta headers", async () => {
    let files: string[];
    try {
      files = await getSpecFiles();
    } catch {
      // No .sakti/specs/ directory in this package — nothing to validate.
      return;
    }
    if (files.length === 0) return;

    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      const relativeFile = path.relative(projectRoot, file);
      const structureIssues = findMainSpecStructureIssues(content);
      const parser = new MarkdownParser(content);
      const spec = parser.parseSpec(path.basename(path.dirname(file)));
      const rawRequirementCount =
        stripFencedCodeBlocksPreservingLines(content).match(REQUIREMENT_HEADER_PATTERN)?.length ??
        0;

      expect(content, `${relativeFile} must include ## Purpose`).toMatch(/^## Purpose$/m);
      expect(content, `${relativeFile} must include ## Requirements`).toMatch(/^## Requirements$/m);
      expect(
        content,
        `${relativeFile} must not include archive placeholder purpose text`,
      ).not.toMatch(PURPOSE_PLACEHOLDER_PATTERN);
      expect(
        structureIssues,
        `${relativeFile} must not contain hidden requirements or delta headers`,
      ).toHaveLength(0);
      expect(
        spec.requirements.length,
        `${relativeFile} parsed requirement count must match visible requirement headers`,
      ).toBe(rawRequirementCount);
    }
  });
});
