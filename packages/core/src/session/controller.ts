/**
 * Session controller (simplified)
 *
 * Manages a single session's agent execution without complex
 * workflow orchestration. The agent decides when to spawn subagents.
 */

import { EventEmitter } from "events";
import { access, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { createAgent } from "../agent/workflow/factory";
import { getSessionRuntimeMode } from "../spec/helpers";
import { AgentProcessor } from "./processor";
import { Checkpoint, SessionConfig, SessionPhase, SessionStatus } from "./types";

/**
 * Session controller class
 *
 * Simplified controller that manages a single agent.
 * The agent uses the task tool to spawn subagents as needed.
 */
export class SessionController {
  sessionId: string;
  private eventBus: EventEmitter;
  private checkpointDir: string;
  private config: SessionConfig;
  private currentCheckpoint: Checkpoint | null = null;

  // Agent state
  private currentAgent: AgentProcessor | null = null;
  private currentPhase: SessionPhase = "idle";
  private abortController: AbortController | null = null;

  constructor(config: {
    sessionId: string;
    sessionConfig: SessionConfig;
    checkpointDir: string;
    restoredCheckpoint?: Checkpoint | null;
  }) {
    this.sessionId = config.sessionId;
    this.config = config.sessionConfig;
    this.checkpointDir = config.checkpointDir;
    this.eventBus = new EventEmitter();

    // If checkpoint exists, restore state
    if (config.restoredCheckpoint) {
      this.restoreState(config.restoredCheckpoint);
    }
  }

  /**
   * Process a user message with the agent
   *
   * @param message - The user's message
   * @param options - Optional callbacks
   * @returns Agent execution result
   */
  async processMessage(
    message: string,
    options?: {
      onEvent?: (event: { type: string; [key: string]: unknown }) => void;
    }
  ): Promise<{
    status: "completed" | "failed" | "stopped";
    finalContent?: string;
    error?: string;
  }> {
    this.currentPhase = "running";

    // Create abort controller for this execution
    this.abortController = new AbortController();

    // Emit start event
    this.emitEvent({
      type: "session-started",
      sessionId: this.sessionId,
      phase: this.currentPhase,
    });

    try {
      // Resolve runtime mode from persisted storage, default to "intake"
      const runtimeMode = (await getSessionRuntimeMode(this.sessionId)) ?? "intake";

      // Map runtime mode to agent type
      // intake → explore (homepage research and decisioning)
      // plan → plan (task-session spec refinement and planning)
      // build → build (implementation and delivery)
      const agentTypeForRuntimeMode = runtimeMode === "intake" ? "explore" : runtimeMode;

      // Create agent configuration based on resolved runtime mode
      const activeModelId = process.env.SAKTI_CODE_ACTIVE_MODEL_ID?.trim();
      const agentConfig = createAgent(
        agentTypeForRuntimeMode,
        this.sessionId,
        activeModelId ? { model: activeModelId } : undefined
      );

      // Create processor
      this.currentAgent = new AgentProcessor(agentConfig, event => {
        // Forward agent events through event bus
        this.emitEvent({
          type: "agent-event",
          sessionId: this.sessionId,
          eventType: event.type,
          ...(event as Record<string, unknown>),
        });

        // Call user callback if provided
        options?.onEvent?.(event as { type: string; [key: string]: unknown });
      });

      // Run the agent
      const result = await this.currentAgent.run({
        task: message,
        context: {
          sessionId: this.sessionId,
          resourceId: this.config.resourceId,
          workspace: this.config.workspace,
        },
      });

      this.currentPhase = result.status === "completed" ? "completed" : "failed";

      // Save checkpoint
      await this.saveCheckpoint({
        sessionId: this.sessionId,
        phase: this.currentPhase,
        task: message,
        timestamp: Date.now(),
        result: {
          agentId: agentConfig.id,
          type: agentConfig.type,
          status: result.status,
          messages: result.messages || [],
          finalContent: result.finalContent,
          iterations: result.iterations,
          duration: result.duration,
        },
      });

      this.emitEvent({
        type: "session-completed",
        sessionId: this.sessionId,
        phase: this.currentPhase,
      });

      return {
        status: result.status,
        finalContent: result.finalContent,
        error: result.error,
      };
    } catch (error) {
      this.currentPhase = "failed";
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.emitEvent({
        type: "session-failed",
        sessionId: this.sessionId,
        error: errorMessage,
      });

      return {
        status: "failed",
        error: errorMessage,
      };
    } finally {
      this.currentAgent = null;
      this.abortController = null;
    }
  }

  /**
   * Get current session status
   */
  getStatus(): SessionStatus {
    return {
      sessionId: this.sessionId,
      phase: this.currentPhase,
      progress: this.currentPhase === "running" ? 0.5 : 1,
      hasIncompleteWork: false,
      summary: this.currentCheckpoint?.result?.finalContent || "",
      lastActivity: Date.now(),
      activeAgents: [],
    };
  }

  /**
   * Check if session has incomplete work
   */
  hasIncompleteWork(): boolean {
    return this.currentPhase === "running";
  }

  /**
   * Abort the current agent execution
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.currentAgent) {
      this.currentAgent.abort();
    }
  }

  /**
   * Check if a checkpoint exists on disk
   */
  async hasCheckpoint(): Promise<boolean> {
    try {
      const checkpointPath = join(this.checkpointDir, "checkpoint.json");
      await access(checkpointPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save checkpoint to disk (public method for shutdown handler)
   */
  async saveCheckpointToDisk(): Promise<void> {
    if (this.currentCheckpoint) {
      await this.saveCheckpointToFile(this.currentCheckpoint);
    }
  }

  /**
   * Save checkpoint
   */
  private async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    this.currentCheckpoint = checkpoint;
    await this.saveCheckpointToFile(checkpoint);
  }

  /**
   * Save checkpoint to file
   */
  private async saveCheckpointToFile(checkpoint: Checkpoint): Promise<void> {
    const checkpointPath = join(this.checkpointDir, "checkpoint.json");
    await mkdir(this.checkpointDir, { recursive: true });
    await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
  }

  /**
   * Restore state from checkpoint
   */
  private restoreState(checkpoint: Checkpoint): void {
    this.currentCheckpoint = checkpoint;
    this.config.task = checkpoint.task;
  }

  /**
   * Emit an event through the event bus
   */
  private emitEvent(event: { type: string; [key: string]: unknown }): void {
    this.eventBus.emit("AGENT_EVENT", event);
  }
}
