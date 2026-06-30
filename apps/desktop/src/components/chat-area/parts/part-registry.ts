import type { Component } from "solid-js";
import type { MessagePart } from "~/stores/types.ts";

export interface PartProps {
  isStreaming?: boolean;
  part: MessagePart;
}

export type PartComponent = Component<PartProps>;

const PART_MAPPING: Record<string, PartComponent | undefined> = {};

export function registerPartComponent(type: string, component: PartComponent): void {
  PART_MAPPING[type] = component;
}

export function getPartComponent(type: string): PartComponent | undefined {
  return PART_MAPPING[type];
}

export function hasPartComponent(type: string): boolean {
  return type in PART_MAPPING;
}

export function clearPartRegistry(): void {
  for (const key of Object.keys(PART_MAPPING)) {
    delete PART_MAPPING[key];
  }
}
