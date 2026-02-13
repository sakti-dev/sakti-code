/**
 * Tool Registry System
 *
 * Provides a registry for tool name -> renderer component mapping.
 * Allows registering custom renderers for specific tools.
 */

import type { Component } from "solid-js";

export interface ToolRendererProps {
  /** The tool part data */
  part: Record<string, unknown>;
  /** Tool execution status */
  status: "running" | "completed" | "error" | "pending";
  /** Tool output/result */
  output?: unknown;
  /** Whether the tool is currently streaming */
  isStreaming?: boolean;
}

export type ToolRenderer = Component<ToolRendererProps>;

const TOOL_RENDERERS: Record<string, ToolRenderer | undefined> = {};

/**
 * Register a renderer for a tool name
 */
export function registerToolRenderer(name: string, renderer: ToolRenderer): void {
  TOOL_RENDERERS[name] = renderer;
}

/**
 * Get a registered renderer by tool name
 */
export function getToolRenderer(name: string): ToolRenderer | undefined {
  return TOOL_RENDERERS[name];
}

/**
 * Check if a tool has a registered renderer
 */
export function hasToolRenderer(name: string): boolean {
  return name in TOOL_RENDERERS;
}

/**
 * Clear all registered renderers (for testing)
 */
export function clearToolRegistry(): void {
  for (const key of Object.keys(TOOL_RENDERERS)) {
    delete TOOL_RENDERERS[key];
  }
}
