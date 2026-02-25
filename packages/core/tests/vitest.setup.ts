import {
  registerCoreBusBindings,
  registerCoreDbBindings,
} from "@sakti-code/shared/core-server-bridge";
import { resolveAppPaths } from "@sakti-code/shared/paths";
import fs from "node:fs";
import path from "node:path";

const testHome = path.resolve(process.cwd(), ".sakti-code-test");
process.env.SAKTI_CODE_HOME = testHome;

const paths = resolveAppPaths();

fs.mkdirSync(paths.config, { recursive: true });
fs.mkdirSync(paths.state, { recursive: true });
fs.mkdirSync(paths.db, { recursive: true });
fs.mkdirSync(paths.logs, { recursive: true });

const dbModule = await import("../../server/db/index.ts");
registerCoreDbBindings({
  getDb: dbModule.getDb,
  closeDb: dbModule.closeDb,
  sessions: dbModule.taskSessions,
  tasks: dbModule.tasks,
  taskDependencies: dbModule.taskDependencies,
  taskMessages: dbModule.taskMessages,
  threads: dbModule.threads,
  messages: dbModule.messages,
  workingMemory: dbModule.workingMemory,
  reflections: dbModule.reflections,
  observationalMemory: dbModule.observationalMemory,
  toolSessions: dbModule.toolSessions,
});

const busModule = await import("../../server/src/bus/index.ts");
registerCoreBusBindings({
  publishTaskUpdated: async (sessionId, tasks) => {
    await busModule.publish(busModule.TaskUpdated, { sessionId, tasks });
  },
});
