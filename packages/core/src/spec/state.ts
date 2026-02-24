/**
 * Spec State Mirror - Safe read/write for spec.json files
 *
 * Phase 2 - Spec System
 * Provides:
 * - SpecStateMirror: Class for reading/writing spec state with defaults
 * - readSpecState: Convenience function for reading spec.json
 * - writeSpecState: Convenience function for writing spec.json
 */

import { promises as fs } from "fs";
import path from "path";

export interface SpecApprovals {
  generated: boolean;
  approved: boolean;
}

export interface SpecState {
  feature_name: string | null;
  phase: string | null;
  approvals: {
    requirements: SpecApprovals;
    design: SpecApprovals;
    tasks: SpecApprovals;
  };
  ready_for_implementation: boolean;
  language: string;
}

export interface WriteResult {
  ok: boolean;
  warning?: string;
}

const DEFAULT_STATE: SpecState = {
  feature_name: null,
  phase: null,
  approvals: {
    requirements: { generated: false, approved: false },
    design: { generated: false, approved: false },
    tasks: { generated: false, approved: false },
  },
  ready_for_implementation: false,
  language: "en",
};

export class SpecStateMirror {
  constructor(private readonly specPath: string) {}

  async read(): Promise<SpecState> {
    try {
      const content = await fs.readFile(this.specPath, "utf-8");
      const parsed = JSON.parse(content);
      return { ...DEFAULT_STATE, ...parsed };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  async write(state: SpecState): Promise<WriteResult> {
    try {
      const dir = path.dirname(this.specPath);
      await fs.mkdir(dir, { recursive: true });
      const content = JSON.stringify(state, null, 2);
      await fs.writeFile(this.specPath, content, "utf-8");
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { ok: false, warning: `Failed to write spec.json: ${message}` };
    }
  }
}

export async function readSpecState(specPath: string): Promise<SpecState> {
  const mirror = new SpecStateMirror(specPath);
  return mirror.read();
}

export async function writeSpecState(specPath: string, state: SpecState): Promise<WriteResult> {
  const mirror = new SpecStateMirror(specPath);
  return mirror.write(state);
}
