import type { AgentMessage } from "@sakti-code/agent";
import type { App } from "@sakti-code/server";
import type {
  Project,
  ServerActions,
  ServerStoreData,
  SessionMeta,
} from "./server-store.ts";
import type { SessionRegistry } from "./session-registry.ts";
import { agentMessageToUI, type UIMessage } from "./types.ts";
import type { WsClient } from "./ws-client.ts";

type ApiClient = ReturnType<typeof import("@elysiajs/eden").treaty<App>>;

export interface ActionsDeps {
  serverStore: { store: ServerStoreData; actions: ServerActions };
  sessionRegistry: SessionRegistry;
}

export interface Actions {
  abortRun: (sessionId: string) => void;
  addProject: (cwd: string) => Promise<Project | undefined>;
  createSession: (
    projectId: string,
    modelId: string,
    title?: string
  ) => Promise<SessionMeta | undefined>;
  followUpRun: (sessionId: string, text: string) => void;
  loadMessages: (sessionId: string) => Promise<void>;
  loadProjects: () => Promise<void>;
  loadSessions: (projectId: string) => Promise<void>;
  sendPrompt: (sessionId: string, text: string) => void;
  steerRun: (sessionId: string, text: string) => void;
}

export function createActions(
  api: ApiClient,
  ws: WsClient,
  deps: ActionsDeps
): Actions {
  const { serverStore: server, sessionRegistry } = deps;

  return {
    async addProject(cwd) {
      const name = cwd.split("/").pop() ?? cwd;
      const { data, error } = await api.api.projects.post({ name, cwd });
      if (error || !data) {
        return;
      }
      const project = data as Project;
      server.actions.addProject(project);
      return project;
    },

    async loadProjects() {
      const { data, error } = await api.api.projects.get();
      if (error || !data) {
        return;
      }
      server.actions.setProjects(data as Project[]);
    },

    async loadSessions(projectId) {
      const { data, error } = await api.api.sessions.get({
        query: { projectId },
      });
      if (error || !data) {
        return;
      }
      server.actions.setSessions(data as SessionMeta[]);
    },

    async createSession(projectId, modelId, title) {
      const { data, error } = await api.api.sessions.post({
        projectId,
        modelId,
        ...(title === undefined ? {} : { title }),
      });
      if (error || !data) {
        return;
      }
      const session = data as SessionMeta;
      server.actions.addSession(session);
      return session;
    },

    async loadMessages(sessionId) {
      const { data, error } = await api.api
        .sessions({ id: sessionId })
        .messages.get();
      if (error || !data) {
        return;
      }
      const messages = data as AgentMessage[];
      const uiMessages = messages.map(agentMessageToUI);
      const session = sessionRegistry.get(sessionId);
      session.actions.loadMessages(uiMessages);
    },

    sendPrompt(sessionId, text) {
      const session = sessionRegistry.get(sessionId);

      const userMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        parts: [{ type: "text", text }],
        isStreaming: false,
        timestamp: Date.now(),
      };
      session.actions.addMessage(userMsg);
      session.actions.setPhase("thinking");

      ws.send({ type: "prompt", sessionId, message: text });
    },

    abortRun(sessionId) {
      ws.send({ type: "abort", sessionId });
    },

    steerRun(sessionId, text) {
      ws.send({ type: "steer", sessionId, message: text });
    },

    followUpRun(sessionId, text) {
      ws.send({ type: "followUp", sessionId, message: text });
    },
  };
}
