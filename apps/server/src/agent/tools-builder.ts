import type { AgentTool } from "@sakti-code/agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  InMemorySnapshotStore,
  type NoopLoopGuardOwner,
} from "@sakti-code/tools";

export function buildTools(cwd: string): AgentTool[] {
  const snapshotStore = new InMemorySnapshotStore();
  const noopOwner: NoopLoopGuardOwner = {};
  return [
    createReadTool(cwd, { autoResizeImages: true, snapshotStore }),
    createWriteTool(cwd, { snapshotStore }),
    createEditTool(cwd, { mode: "hashline", snapshotStore, noopOwner }),
    createBashTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ] as AgentTool[];
}
