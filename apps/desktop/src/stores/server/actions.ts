import type { AgentMessage, PermissionReply } from "@sakti-code/agent";
import type { Client } from "~/lib/api";
import { createLogger } from "~/lib/utils";
import {
  type ChatTurnDTO,
  hydrateChatSummaries,
  hydrateIntermediates,
} from "../session/hydrate-chat.ts";
import { hydrateSessionMessages } from "../session/hydrate-messages.ts";
import type { SessionRegistry } from "../session/session-registry.ts";
import type { UIMessage } from "../types.ts";
import { setLastError, setReplayState } from "../workspace/ui-signals.ts";
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
  createSession: (projectId: string, title?: string) => Promise<SessionMeta | undefined>;
  evictIntermediates: (sessionId: string, turnId: string) => void;
  followUpRun: (sessionId: string, text: string) => void;
  loadChat: (sessionId: string) => Promise<void>;
  loadIntermediates: (sessionId: string, turnId: string) => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  loadProjects: () => Promise<void>;
  loadSessions: (projectId: string) => Promise<void>;
  replayPause: (sessionId: string) => void;
  replayReset: (sessionId: string) => void;
  replayResume: (sessionId: string) => void;
  replayStart: (sessionId: string) => void;
  replyPermission: (sessionId: string, id: string, reply: PermissionReply) => void;
  selectProfile: (sessionId: string | null, profileId: string) => Promise<void>;
  sendPrompt: (sessionId: string, text: string) => void;
  steerRun: (sessionId: string, text: string) => void;
  upsertIntakeSession: (projectId: string) => Promise<SessionMeta | undefined>;
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

    async upsertIntakeSession(projectId) {
      try {
        const res = await api.api.projects[":id"]["intake-session"].$post({
          param: { id: projectId },
        });
        if (!res.ok) {
          return;
        }
        const session = (await res.json()) as SessionMeta;
        server.actions.addSession(session);
        return session;
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to upsert intake session");
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
        const uiMessages = hydrateSessionMessages(messages);
        const session = sessionRegistry.get(sessionId);
        session.actions.loadMessages(uiMessages);

        try {
          const turnsRes = await api.api.sessions[":id"].turns.$get({
            param: { id: sessionId },
          });
          if (turnsRes.ok) {
            const turns = (await turnsRes.json()) as Array<{
              startedAt: number;
              endedAt: number | null;
            }>;
            session.actions.loadTurnTimings(
              turns.map((t) => ({
                startedAt: t.startedAt,
                endedAt: t.endedAt,
              })),
            );
          }
        } catch {
          // turns endpoint not available (older server)
        }
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
        const { messages, turns } = hydrateChatSummaries(body.turns);
        const session = sessionRegistry.get(sessionId);
        session.actions.loadChatTurns(turns, messages);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to load chat");
      }
    },

    async loadIntermediates(sessionId, turnId) {
      try {
        const res = await api.api.sessions[":id"].turns[":turnId"].intermediates.$get({
          param: { id: sessionId, turnId },
        });
        if (!res.ok) {
          return;
        }
        const body = (await res.json()) as { entries: Array<Record<string, unknown>> };
        const messages = hydrateIntermediates(body.entries);
        const session = sessionRegistry.get(sessionId);
        session.actions.loadTurnIntermediates(turnId, messages);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "Failed to load intermediates");
      }
    },

    evictIntermediates(sessionId, turnId) {
      const session = sessionRegistry.get(sessionId);
      session.actions.evictTurnIntermediates(turnId);
    },

    sendPrompt(sessionId, text) {
      if (text === "/compact" || text.startsWith("/compact ")) {
        const customInstructions = text.startsWith("/compact ")
          ? text.slice("/compact ".length).trim()
          : undefined;
        ws.send({
          type: "command",
          sessionId,
          name: "compact",
          ...(customInstructions !== undefined ? { customInstructions } : {}),
        });
        return;
      }

      const session = sessionRegistry.get(sessionId);
      const sessionMeta = server.store.sessions[sessionId];

      log.info("user prompt", { sessionId, messageLength: text.length });
      log.debug("prompt submitted", {
        ...(sessionMeta?.modelId ? { modelId: sessionMeta.modelId } : {}),
        ...(sessionMeta?.thinkingLevel ? { thinkingLevel: sessionMeta.thinkingLevel } : {}),
      });

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

    replayStart(sessionId) {
      const session = sessionRegistry.get(sessionId);
      session.actions.reset();
      setReplayState("playing");
      ws.send({ type: "replay", sessionId, action: "start" });
    },

    replyPermission(sessionId, id, reply) {
      ws.send({ type: "permission.reply", sessionId, id, reply });
    },

    replayPause(sessionId) {
      setReplayState("paused");
      ws.send({ type: "replay", sessionId, action: "pause" });
    },

    replayResume(sessionId) {
      setReplayState("playing");
      ws.send({ type: "replay", sessionId, action: "resume" });
    },

    replayReset(sessionId) {
      ws.send({ type: "abort", sessionId });
      const session = sessionRegistry.get(sessionId);
      session.actions.reset();
      setReplayState("idle");
    },
  };
}
