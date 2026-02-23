/**
 * Question Manager - Event-based question/answer lifecycle
 *
 * Provides a process-wide manager for tool-driven user questions.
 * Flow:
 * - Tool calls ask() and receives a pending request ID
 * - UI answers via reply() or reject()
 * - Original ask() promise resolves/rejects
 */

import { EventEmitter } from "events";
import { v7 as uuidv7 } from "uuid";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionPrompt {
  header?: string;
  question: string;
  options?: QuestionOption[];
  multiple?: boolean;
}

export interface QuestionRequest {
  id: string;
  sessionID: string;
  questions: QuestionPrompt[];
  tool?: { messageID: string; callID: string };
}

export interface QuestionReplyInput {
  id: string;
  reply: unknown;
}

export interface QuestionRejectInput {
  id: string;
  reason?: string;
}

export class QuestionRejectedError extends Error {
  constructor(
    public readonly requestID: string,
    public readonly sessionID: string,
    public readonly reason?: string
  ) {
    super(reason ? `Question rejected: ${reason}` : "Question rejected by user");
    this.name = "QuestionRejectedError";
  }
}

export class QuestionManager extends EventEmitter {
  private static instance: QuestionManager;

  private pendingRequests = new Map<
    string,
    {
      request: QuestionRequest;
      resolve: (reply: unknown) => void;
      reject: (error: QuestionRejectedError) => void;
    }
  >();

  private constructor() {
    super();
  }

  static getInstance(): QuestionManager {
    if (!this.instance) {
      this.instance = new QuestionManager();
    }
    return this.instance;
  }

  async ask(input: Omit<QuestionRequest, "id">): Promise<unknown> {
    const request: QuestionRequest = {
      id: uuidv7(),
      sessionID: input.sessionID,
      questions: input.questions,
      tool: input.tool,
    };

    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(request.id, {
        request,
        resolve,
        reject,
      });

      this.emit("question:request", request);
    });
  }

  reply(input: QuestionReplyInput): boolean {
    const pending = this.pendingRequests.get(input.id);
    if (!pending) return false;

    this.pendingRequests.delete(input.id);
    pending.resolve(input.reply);
    this.emit("question:reply", {
      sessionID: pending.request.sessionID,
      requestID: input.id,
      reply: input.reply,
    });

    return true;
  }

  reject(input: QuestionRejectInput): boolean {
    const pending = this.pendingRequests.get(input.id);
    if (!pending) return false;

    this.pendingRequests.delete(input.id);
    const error = new QuestionRejectedError(input.id, pending.request.sessionID, input.reason);
    pending.reject(error);
    this.emit("question:reject", {
      sessionID: pending.request.sessionID,
      requestID: input.id,
      reason: input.reason,
    });

    return true;
  }

  getPendingRequests(): QuestionRequest[] {
    return Array.from(this.pendingRequests.values()).map(value => value.request);
  }

  clearSession(sessionID: string): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      if (pending.request.sessionID !== sessionID) continue;
      this.pendingRequests.delete(id);
      pending.reject(new QuestionRejectedError(id, sessionID, "Session cleared"));
    }
  }

  reset(): void {
    this.pendingRequests.clear();
  }
}
