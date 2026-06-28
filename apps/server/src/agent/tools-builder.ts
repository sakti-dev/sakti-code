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
} from "@sakti-code/tools";

export function buildTools(cwd: string): AgentTool[] {
  const snapshotStore = new InMemorySnapshotStore();
  return [
    createReadTool(cwd, { autoResizeImages: true, snapshotStore }),
    createWriteTool(cwd, { snapshotStore }),
    createEditTool(cwd, { mode: "hashline", snapshotStore }),
    createBashTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ] as AgentTool[];
}
