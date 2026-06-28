import type { AgentTool } from "@sakti-code/agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type EditMode,
  InMemorySnapshotStore,
  type NoopLoopGuardOwner,
} from "@sakti-code/tools";

export function buildTools(
  cwd: string,
  editMode: EditMode = "hashline"
): AgentTool[] {
  const snapshotStore = new InMemorySnapshotStore();
  const noopOwner: NoopLoopGuardOwner = {};
  return [
    createReadTool(cwd, { autoResizeImages: true, snapshotStore }),
    createWriteTool(cwd, { snapshotStore }),
    createEditTool(cwd, { mode: editMode, snapshotStore, noopOwner }),
    createBashTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ] as AgentTool[];
}
