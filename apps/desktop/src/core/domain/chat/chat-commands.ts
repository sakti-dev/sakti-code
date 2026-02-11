/**
 * Chat Commands
 *
 * Application commands for chat operations.
 * Commands are pure functions that accept dependencies as parameters.
 */

export interface ChatCommandDependencies {
  apiClient: {
    chat: {
      create: (params: { sessionID: string; content: string }) => Promise<void>;
      stop: (sessionID: string) => Promise<void>;
    };
  };
}

export interface ChatCommands {
  sendMessage: (params: { sessionID: string; content: string }) => Promise<void>;
  stopMessage: (params: { sessionID: string }) => Promise<void>;
}

export function createChatCommands(deps: ChatCommandDependencies): ChatCommands {
  return {
    sendMessage: async ({ sessionID, content }) => {
      await deps.apiClient.chat.create({ sessionID, content });
    },

    stopMessage: async ({ sessionID }) => {
      await deps.apiClient.chat.stop(sessionID);
    },
  };
}
