import type { AgentMessage } from "@sakti-code/agent";
import type { Client } from "~/lib/api";
import type {
  Project,
  ServerActions,
  ServerStoreData,
  SessionMeta,
} from "./server-store.ts";
import type { SessionRegistry } from "./session-registry.ts";
import { agentMessageToUI, type UIMessage } from "./types.ts";
import type { WsClient } from "./ws-client.ts";

type ApiClient = Client;

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
      const res = await api.api.projects.$post({ json: { name, cwd } });
      if (!res.ok) {
        return;
      }
      const project = (await res.json()) as Project;
      server.actions.addProject(project);
      return project;
    },

    async loadProjects() {
      const res = await api.api.projects.$get();
      if (!res.ok) {
        return;
      }
      server.actions.setProjects((await res.json()) as Project[]);
    },

    async loadSessions(projectId) {
      const res = await api.api.sessions.$get({ query: { projectId } });
      if (!res.ok) {
        return;
      }
      server.actions.setSessions((await res.json()) as SessionMeta[]);
    },

    async createSession(projectId, modelId, title) {
      const res = await api.api.sessions.$post({
        json: {
          projectId,
          modelId,
          ...(title === undefined ? {} : { title }),
        },
      });
      if (!res.ok) {
        return;
      }
      const session = (await res.json()) as SessionMeta;
      server.actions.addSession(session);
      return session;
    },

    async loadMessages(sessionId) {
      const res = await api.api.sessions[":id"].messages.$get({
        param: { id: sessionId },
      });
      if (!res.ok) {
        return;
      }
      const messages = (await res.json()) as AgentMessage[];
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
