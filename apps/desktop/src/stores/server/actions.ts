import type { AgentMessage, PermissionReply } from "@sakti-code/agent";
import type { Client } from "~/lib/api";
import { createLogger } from "~/lib/utils";
import {
  type ChatTurnDTO,
  hydrateChatTurns,
  hydrateIntermediates,
} from "../session/hydrate-chat.ts";
import { hydrateSessionTurns } from "../session/hydrate-messages.ts";
import type { SessionRegistry } from "../session/session-registry.ts";
import type { UIMessage } from "../types.ts";
import { setLastError } from "../workspace/ui-signals.ts";
import type { Project, ServerActions, ServerStoreData, SessionMeta } from "./server-store.ts";
import type { WsClient } from "./ws-client.ts";

const log = createLogger({ module: "actions" });

type ApiClient = Client;

export interface ActionsDeps {
  serverStore: { store: ServerStoreData; actions: ServerActions };
  sessionRegistry: SessionRegistry;
}

export interface Actions {
  abortRun: (sessionId: string) => void;
  addProject: (cwd: string) => Promise<Project | undefined>;
  confirmAsk: (
    sessionId: string,
    kind: string,
    body: string,
    action: "approve" | "reject",
  ) => Promise<boolean>;
  createSession: (projectId: string, title?: string) => Promise<SessionMeta | undefined>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  evictIntermediates: (sessionId: string, turnId: string) => void;
  followUpRun: (sessionId: string, text: string) => void;
  loadChat: (sessionId: string) => Promise<void>;
  loadIntermediates: (sessionId: string, turnId: string) => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  loadProjects: () => Promise<void>;
  loadSessions: (projectId: string) => Promise<void>;
  replyPermission: (sessionId: string, id: string, reply: PermissionReply) => void;
  renameSession: (sessionId: string, title: string) => Promise<boolean>;
  selectProfile: (sessionId: string | null, profileId: string) => Promise<void>;
  sendPrompt: (sessionId: string, text: string) => void;
  steerRun: (sessionId: string, text: string) => void;
  createChildPlan: (projectId: string) => Promise<SessionMeta | undefined>;
  listChildPlans: (projectId: string) => Promise<SessionMeta[]>;
}

export function createActions(api: ApiClient, ws: WsClient, deps: ActionsDeps): Actions {
  const { serverStore: server, sessionRegistry } = deps;

  return {
    async addProject(cwd) {
      try {
        const name = cwd.split("/").pop() ?? cwd;
        const res = await api.api.projects.$post({ json: { name, cwd } });
        if (!res.ok) {
          return;
        }
        const project = (await res.json()) as Project;
        server.actions.addProject(project);
        return project;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to add project");
      }
    },

    async loadProjects() {
      try {
        const res = await api.api.projects.$get();
        if (!res.ok) {
          return;
        }
        server.actions.setProjects((await res.json()) as Project[]);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to load projects");
      }
    },

    async loadSessions(projectId) {
      try {
        const res = await api.api.sessions.$get({ query: { projectId } });
        if (!res.ok) {
          return;
        }
        server.actions.setSessions((await res.json()) as SessionMeta[]);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to load sessions");
      }
    },

    async createSession(projectId, title) {
      try {
        const res = await api.api.sessions.$post({
          json: {
            projectId,
            ...(title === undefined ? {} : { title }),
          },
        });
        if (!res.ok) {
          return;
        }
        const session = (await res.json()) as SessionMeta;
        server.actions.addSession(session);
        return session;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to create session");
      }
    },

    async createChildPlan(projectId) {
      try {
        const res = await api.api.projects[":id"]["plan-session"].$post({
          param: { id: projectId },
        });
        if (!res.ok) {
          return;
        }
        const session = (await res.json()) as SessionMeta;
        server.actions.addSession(session);
        return session;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to create child plan");
      }
    },

    async listChildPlans(projectId) {
      try {
        const res = await api.api.projects[":id"]["plan-sessions"].$get({
          param: { id: projectId },
        });
        if (!res.ok) {
          return [];
        }
        const list = (await res.json()) as SessionMeta[];
        for (const session of list) {
          server.actions.addSession(session);
        }
        return list;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to list child plans");
        return [];
      }
    },

    async loadMessages(sessionId) {
      try {
        const res = await api.api.sessions[":id"].messages.$get({
          param: { id: sessionId },
        });
        if (!res.ok) {
          return;
        }
        const messages = (await res.json()) as AgentMessage[];
        const turns = hydrateSessionTurns(messages);
        const session = sessionRegistry.get(sessionId);
        session.actions.loadTurns(turns);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to load messages");
      }
    },

    async loadChat(sessionId) {
      try {
        const res = await api.api.sessions[":id"].chat.$get({ param: { id: sessionId } });
        if (!res.ok) {
          return;
        }
        const body = (await res.json()) as { turns: ChatTurnDTO[] };
        const turns = hydrateChatTurns(body.turns);
        const session = sessionRegistry.get(sessionId);
        session.actions.loadTurns(turns);
        // Re-derive the pending ask from persisted server state so the confirm
        // card survives reload (the live WS event path sets it during a run).
        const meta = server.store.sessions[sessionId];
        if (meta?.pendingAskKind && meta?.pendingAskBody) {
          session.actions.setPendingAsk({ kind: meta.pendingAskKind, body: meta.pendingAskBody });
        } else {
          session.actions.clearPendingAsk();
        }
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to load chat");
      }
    },

    async loadIntermediates(sessionId, turnId) {
      log.info("loadIntermediates called", { sessionId, turnId });
      try {
        const res = await api.api.sessions[":id"].turns[":turnId"].intermediates.$get({
          param: { id: sessionId, turnId },
        });
        if (!res.ok) {
          log.warn("loadIntermediates fetch failed", { sessionId, turnId, status: res.status });
          return;
        }
        const body = (await res.json()) as { entries: Array<Record<string, unknown>> };
        const messages = hydrateIntermediates(body.entries);
        log.info("loadIntermediates resolved", { sessionId, turnId, count: messages.length });
        const session = sessionRegistry.get(sessionId);
        session.actions.loadIntermediates(turnId, messages);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to load intermediates");
      }
    },

    evictIntermediates(sessionId, turnId) {
      log.info("evictIntermediates called", { sessionId, turnId });
      const session = sessionRegistry.get(sessionId);
      session.actions.evictIntermediates(turnId);
    },

    sendPrompt(sessionId, text) {
      const session = sessionRegistry.get(sessionId);
      const sessionMeta = server.store.sessions[sessionId];

      // A new prompt supersedes any pending ask card (the user typed instead
      // of clicking Approve/Revise). Clears both the local card and the
      // server-side persisted state (the run starting server-side also clears).
      session.actions.clearPendingAsk();
      if (sessionMeta?.pendingAskKind) {
        server.actions.updateSession(sessionId, {
          pendingAskKind: null,
          pendingAskBody: null,
        });
      }

      log.info("user prompt", { sessionId, messageLength: text.length });
      log.debug("prompt submitted", {
        ...(sessionMeta?.modelId ? { modelId: sessionMeta.modelId } : {}),
        ...(sessionMeta?.thinkingLevel ? { thinkingLevel: sessionMeta.thinkingLevel } : {}),
      });

      const userMsg: UIMessage = {
        content: text,
        id: crypto.randomUUID(),
        isStreaming: false,
        parts: [{ type: "text", text }],
        role: "user",
        timestamp: Date.now(),
      };
      session.actions.startTurn(userMsg);
      session.actions.setPhase("thinking");

      ws.send({ type: "prompt", sessionId, message: text });
    },

    abortRun(sessionId) {
      ws.send({ type: "abort", sessionId });
    },

    async confirmAsk(sessionId, kind, body, action) {
      try {
        const res = await api.api.sessions[":id"].confirm.$post({
          param: { id: sessionId },
          json: { action, kind, body },
        });
        if (!res.ok) {
          setLastError(`Failed to ${action} (${res.status})`);
          return false;
        }
        const updated = (await res.json()) as SessionMeta;
        // Mirror the server: status advanced + pending ask cleared.
        server.actions.updateSession(sessionId, {
          status: updated.status,
          pendingAskKind: null,
          pendingAskBody: null,
        });
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to confirm ask");
        return false;
      }
    },

    async deleteSession(sessionId) {
      try {
        const res = await api.api.sessions[":id"].$delete({ param: { id: sessionId } });
        if (!res.ok) {
          setLastError(`Failed to delete session (${res.status})`);
          return false;
        }
        server.actions.removeSession(sessionId);
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to delete session");
        return false;
      }
    },

    async renameSession(sessionId, title) {
      try {
        const res = await api.api.sessions[":id"].$patch({
          param: { id: sessionId },
          json: { title },
        });
        if (!res.ok) {
          setLastError(`Failed to rename session (${res.status})`);
          return false;
        }
        const updated = (await res.json()) as SessionMeta;
        server.actions.updateSession(sessionId, { title: updated.title });
        return true;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to rename session");
        return false;
      }
    },

    async selectProfile(sessionId, profileId) {
      if (!sessionId) {
        return;
      }
      try {
        const res = await api.api.sessions[":id"].$patch({
          param: { id: sessionId },
          json: { profileId },
        });
        if (!res.ok) {
          return;
        }
        const updated = (await res.json()) as SessionMeta;
        server.actions.updateSession(sessionId, {
          profileId: updated.profileId,
        });
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to select profile");
      }
    },

    steerRun(sessionId, text) {
      ws.send({ type: "steer", sessionId, message: text });
    },

    followUpRun(sessionId, text) {
      ws.send({ type: "followUp", sessionId, message: text });
    },

    replyPermission(sessionId, id, reply) {
      ws.send({ type: "permission.reply", sessionId, id, reply });
    },
  };
}
