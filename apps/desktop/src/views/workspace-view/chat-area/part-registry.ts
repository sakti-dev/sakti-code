/**
 * Part Registry System
 *
 * Provides a registry for part type -> component mapping.
 * Allows registering custom components for different part types.
 */

import type { Component } from "solid-js";

export interface PartProps {
  part: Record<string, unknown>;
  message?: unknown;
  hideDetails?: boolean;
  defaultOpen?: boolean;
  isStreaming?: boolean;
  isScrollActive?: boolean;
  onPermissionApprove?: (id: string, patterns?: string[]) => void | Promise<void>;
  onPermissionDeny?: (id: string) => void | Promise<void>;
  onQuestionAnswer?: (id: string, answer: unknown) => void | Promise<void>;
  onQuestionReject?: (id: string) => void | Promise<void>;
}

export type PartComponent = Component<PartProps>;

const PART_MAPPING: Record<string, PartComponent | undefined> = {};

/**
 * Register a component for a part type
 */
export function registerPartComponent(type: string, component: PartComponent): void {
  PART_MAPPING[type] = component;
}

/**
 * Get a registered component by part type
 */
export function getPartComponent(type: string): PartComponent | undefined {
  return PART_MAPPING[type];
}

/**
 * Check if a part type has a registered component
 */
export function hasPartComponent(type: string): boolean {
  return type in PART_MAPPING;
}

/**
 * Clear all registered components (for testing)
 */
export function clearPartRegistry(): void {
  for (const key of Object.keys(PART_MAPPING)) {
    delete PART_MAPPING[key];
  }
}
