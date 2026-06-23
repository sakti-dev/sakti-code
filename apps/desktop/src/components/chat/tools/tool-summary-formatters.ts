import { middleEllipsisPath } from "~/lib/utils/path-utils";

const PATH_MAX_LENGTH = 50;

interface ToolPartData {
  args?: Record<string, unknown>;
  output?: unknown;
  tool: string;
}

function getArgs(part: ToolPartData): Record<string, unknown> {
  return part.args ?? {};
}

function humanizeToolName(toolName: string): string {
  return toolName.replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ").trim();
}

function extractTargetPath(args: Record<string, unknown>): string | undefined {
  const directPathCandidates = [
    args.filePath,
    args.path,
    args.dirPath,
    args.AbsolutePath,
    args.TargetFile,
  ];

  for (const candidate of directPathCandidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  if (Array.isArray(args.files) && args.files.length > 0) {
    const firstFile = args.files[0];
    if (
      firstFile &&
      typeof firstFile === "object" &&
      typeof (firstFile as Record<string, unknown>).filePath === "string"
    ) {
      return (firstFile as Record<string, unknown>).filePath as string;
    }
  }

  return;
}

export function formatGenericToolSummary(part: ToolPartData): string {
  const args = getArgs(part);
  const targetPath = extractTargetPath(args);
  const toolName = humanizeToolName(part.tool || "unknown");

  if (targetPath) {
    return `${toolName} ${middleEllipsisPath(targetPath, PATH_MAX_LENGTH)}`;
  }

  const command = args.command;
  if (typeof command === "string" && command.length > 0) {
    return `${toolName}: ${command.length > 60 ? `${command.slice(0, 57)}...` : command}`;
  }

  return `Used ${toolName}`;
}

export function formatReadSummary(part: ToolPartData): string {
  const args = getArgs(part);
  const filePath =
    (typeof args.filePath === "string" ? args.filePath : undefined) ??
    (typeof args.path === "string" ? args.path : undefined) ??
    "unknown";
  return `Analyzed ${middleEllipsisPath(filePath, PATH_MAX_LENGTH)}`;
}

export function formatWriteSummary(part: ToolPartData): string {
  const args = getArgs(part);
  const filePath =
    (typeof args.filePath === "string" ? args.filePath : undefined) ??
    (typeof args.path === "string" ? args.path : undefined) ??
    "unknown";
  return `Created ${middleEllipsisPath(filePath, PATH_MAX_LENGTH)}`;
}

export function formatEditSummary(part: ToolPartData): string {
  const args = getArgs(part);
  const filePath =
    (typeof args.filePath === "string" ? args.filePath : undefined) ??
    (typeof args.path === "string" ? args.path : undefined) ??
    "unknown";
  return `Edited ${middleEllipsisPath(filePath, PATH_MAX_LENGTH)}`;
}

export function formatBashSummary(part: ToolPartData): string {
  const args = getArgs(part);
  const description = args.description;
  const command =
    (typeof args.command === "string" ? args.command : undefined) ??
    "unknown command";

  let text: string;
  if (typeof description === "string" && description) {
    text = description;
  } else {
    text = command.length > 60 ? `${command.slice(0, 57)}...` : command;
  }

  return `Executed: ${text}`;
}

export function formatGlobSummary(part: ToolPartData): string {
  const args = getArgs(part);
  const pattern =
    (typeof args.pattern === "string" ? args.pattern : undefined) ?? "*";
  const path = typeof args.path === "string" ? args.path : undefined;
  const pathPart = path ? ` in ${path}` : "";
  return `Found files matching ${pattern}${pathPart}`;
}

export function formatGrepSummary(part: ToolPartData): string {
  const args = getArgs(part);
  const pattern =
    (typeof args.pattern === "string" ? args.pattern : undefined) ?? "unknown";
  const path = typeof args.path === "string" ? args.path : undefined;

  const pathPart = path ? ` in ${path}` : "";
  return `Searched "${pattern}" using Grep${pathPart}`;
}

export function formatLsSummary(part: ToolPartData): string {
  const args = getArgs(part);
  const dirPath =
    (typeof args.dirPath === "string" ? args.dirPath : undefined) ??
    (typeof args.path === "string" ? args.path : undefined) ??
    ".";
  const abbreviatedPath = middleEllipsisPath(
    dirPath === "." ? "current directory" : dirPath,
    PATH_MAX_LENGTH
  );

  return `Listed ${abbreviatedPath}`;
}
