import { FiCircle } from "solid-icons/fi";
import { type Component } from "solid-js";

export type ToolIconCmp = Component<{ part: ToolPartData }>;

export interface ToolPartData {
  tool: string;
  args?: Record<string, unknown>;
  output?: unknown;
  details?: unknown;
}

export interface ToolDescriptor {
  /** Canonical name first, then aliases. Drives normalizeToolName. */
  names: string[];
  /** "explore" tools merge into the ExploreStep run. */
  group?: "explore";
  /** Owns its icon; receives part for dynamic cases (read dir/file). */
  icon: ToolIconCmp;
  summary: (part: ToolPartData) => string;
}

export const TOOL_ICON_CLASS = "h-4 w-4 shrink-0 text-muted-foreground";

const entries = new Map<string, { canonical: string; descriptor: ToolDescriptor }>();

// ---- generic fallback (self-contained; for unknown / legacy tools) ----
function humanize(name: string): string {
  return name.replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ").trim();
}

function extractTargetPath(args: Record<string, unknown>): string | undefined {
  for (const key of ["filePath", "path", "dirPath", "AbsolutePath", "TargetFile"]) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  if (Array.isArray(args.files) && args.files.length > 0) {
    const first = args.files[0] as Record<string, unknown> | undefined;
    if (first && typeof first.filePath === "string") return first.filePath;
  }
  return undefined;
}

const genericDescriptor: ToolDescriptor = {
  names: [],
  icon: () => <FiCircle class={TOOL_ICON_CLASS} />,
  summary: (part) => {
    const name = humanize(part.tool || "unknown");
    const args = part.args ?? {};
    const target = extractTargetPath(args);
    if (target) return `${name} ${target}`;
    const command = args.command;
    if (typeof command === "string" && command.length > 0) {
      return `${name}: ${command.length > 60 ? `${command.slice(0, 57)}...` : command}`;
    }
    return `Used ${name}`;
  },
};

// ---- mechanics ----
export function registerTool(descriptor: ToolDescriptor): void {
  const [canonical] = descriptor.names;
  if (!canonical) throw new Error("ToolDescriptor.names requires a canonical name");
  for (const name of descriptor.names) {
    entries.set(name, { canonical, descriptor });
  }
}

export function normalizeToolName(raw: string | undefined): string {
  if (!raw) return "unknown";
  return entries.get(raw)?.canonical ?? raw;
}

export function getToolDescriptor(name: string): ToolDescriptor {
  return entries.get(name)?.descriptor ?? genericDescriptor;
}

export function isExploreTool(name: string): boolean {
  return getToolDescriptor(name).group === "explore";
}

export function clearToolRegistry(): void {
  entries.clear();
}
