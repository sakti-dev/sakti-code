import type { ToolDescriptor } from "./store.tsx";
import { clearToolRegistry, registerTool } from "./store.tsx";
import * as store from "./store.tsx";
import { bashTool } from "./registry/bash.tsx";
import { editTool } from "./registry/edit.tsx";
import { findTool } from "./registry/find.tsx";
import { grepTool } from "./registry/grep.tsx";
import { proposeSessionTool } from "./registry/propose-session.tsx";
import { readTool } from "./registry/read.tsx";
import { webfetchTool } from "./registry/webfetch.tsx";
import { websearchTool } from "./registry/websearch.tsx";
import { writeTool } from "./registry/write.tsx";

const ALL: ToolDescriptor[] = [
  readTool,
  writeTool,
  editTool,
  bashTool,
  grepTool,
  findTool,
  webfetchTool,
  websearchTool,
  proposeSessionTool,
];

let initialized = false;

/** Register every tool descriptor. Idempotent. */
export function ensureToolsRegistered(): void {
  if (initialized) return;
  initialized = true;
  for (const descriptor of ALL) registerTool(descriptor);
}

/** Clear + reset the init flag so the next access re-registers (test infra). */
export function resetToolRegistry(): void {
  clearToolRegistry();
  initialized = false;
}

// Public lookups auto-init on first use, so consumers/tests never think about order.
export function getToolDescriptor(name: string): ToolDescriptor {
  ensureToolsRegistered();
  return store.getToolDescriptor(name);
}

export function normalizeToolName(raw: string | undefined): string {
  ensureToolsRegistered();
  return store.normalizeToolName(raw);
}

export function isExploreTool(name: string): boolean {
  ensureToolsRegistered();
  return store.isExploreTool(name);
}

export type { ToolDescriptor, ToolIconCmp, ToolPartData } from "./store.tsx";
export { TOOL_ICON_CLASS } from "./store.tsx";
export { toToolPartData } from "./shared.ts";
