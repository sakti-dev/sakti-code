/**
 * Message Types - Part-based message model
 *
 * Opencode-style message model with typed parts array.
 * Each message has an array of parts (text, tool, reasoning, etc.)
 * enabling flexible, extensible message content.
 */

import { z } from "zod";

/**
 * Session hierarchy types
 */

/**
 * Session summary metadata
 */
export const SessionSummary = z
  .object({
    additions: z.number().optional(),
    deletions: z.number().optional(),
    files: z.number().optional(),
    diffs: z.number().optional(),
  })
  .meta({
    ref: "SessionSummary",
  });
export type SessionSummary = z.infer<typeof SessionSummary>;

/**
 * Session share info
 */
export const SessionShare = z
  .object({
    url: z.string().optional(),
  })
  .meta({
    ref: "SessionShare",
  });
export type SessionShare = z.infer<typeof SessionShare>;

/**
 * Session with hierarchy support
 */
export const Session = z
  .object({
    sessionId: z.string(),
    resourceId: z.string(),
    threadId: z.string().optional(),
    parentId: z.string().optional(), // For session hierarchy
    createdAt: z.number(),
    lastAccessed: z.number(),
    title: z.string().optional(), // Display title
    summary: SessionSummary.optional(),
    share: SessionShare.optional(),
  })
  .meta({
    ref: "Session",
  });
export type Session = z.infer<typeof Session>;

/**
 * File diff types for session changes
 */
export const FileDiff = z
  .object({
    path: z.string(),
    status: z.enum(["added", "modified", "deleted", "renamed"]),
    additions: z.number().optional(),
    deletions: z.number().optional(),
    patch: z.string().optional(),
  })
  .meta({
    ref: "FileDiff",
  });
export type FileDiff = z.infer<typeof FileDiff>;

/**
 * Todo item types for action items
 */
export const TodoItem = z
  .object({
    id: z.string(),
    text: z.string(),
    done: z.boolean().optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
  })
  .meta({
    ref: "TodoItem",
  });
export type TodoItem = z.infer<typeof TodoItem>;

/**
 * Base part schema with common identifiers
 */
const PartBase = z.object({
  id: z.string(),
  sessionID: z.string(),
  messageID: z.string(),
});

/**
 * Text part - streaming text content
 */
export const TextPart = PartBase.extend({
  type: z.literal("text"),
  text: z.string(),
  synthetic: z.boolean().optional(),
  ignored: z.boolean().optional(),
  time: z
    .object({
      start: z.number(),
      end: z.number().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.any()).optional(),
}).meta({
  ref: "TextPart",
});
export type TextPart = z.infer<typeof TextPart>;

/**
 * Reasoning part - agent thinking/reasoning content
 */
export const ReasoningPart = PartBase.extend({
  type: z.literal("reasoning"),
  text: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
  time: z.object({
    start: z.number(),
    end: z.number().optional(),
  }),
}).meta({
  ref: "ReasoningPart",
});
export type ReasoningPart = z.infer<typeof ReasoningPart>;

/**
 * Tool state machine - follows Opencode pattern
 */
export const ToolStatePending = z
  .object({
    status: z.literal("pending"),
    input: z.record(z.string(), z.any()),
    raw: z.string(),
  })
  .meta({
    ref: "ToolStatePending",
  });
export type ToolStatePending = z.infer<typeof ToolStatePending>;

export const ToolStateRunning = z
  .object({
    status: z.literal("running"),
    input: z.record(z.string(), z.any()),
    title: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
      start: z.number(),
    }),
  })
  .meta({
    ref: "ToolStateRunning",
  });
export type ToolStateRunning = z.infer<typeof ToolStateRunning>;

export const ToolStateCompleted = z
  .object({
    status: z.literal("completed"),
    input: z.record(z.string(), z.any()),
    output: z.string(),
    title: z.string(),
    metadata: z.record(z.string(), z.any()),
    time: z.object({
      start: z.number(),
      end: z.number(),
      compacted: z.number().optional(),
    }),
    attachments: z.lazy(() => FilePart.array()).optional(),
  })
  .meta({
    ref: "ToolStateCompleted",
  });
export type ToolStateCompleted = z.infer<typeof ToolStateCompleted>;

export const ToolStateError = z
  .object({
    status: z.literal("error"),
    input: z.record(z.string(), z.any()),
    error: z.string(),
    metadata: z.record(z.string(), z.any()).optional(),
    time: z.object({
      start: z.number(),
      end: z.number(),
    }),
  })
  .meta({
    ref: "ToolStateError",
  });
export type ToolStateError = z.infer<typeof ToolStateError>;

export const ToolState = z
  .discriminatedUnion("status", [
    ToolStatePending,
    ToolStateRunning,
    ToolStateCompleted,
    ToolStateError,
  ])
  .meta({
    ref: "ToolState",
  });
export type ToolState = z.infer<typeof ToolState>;

/**
 * Tool part - tool execution with state machine
 */
export const ToolPart = PartBase.extend({
  type: z.literal("tool"),
  callID: z.string(),
  tool: z.string(),
  state: ToolState,
  metadata: z.record(z.string(), z.any()).optional(),
}).meta({
  ref: "ToolPart",
});
export type ToolPart = z.infer<typeof ToolPart>;

/**
 * File source types for file parts
 */
const FilePartSourceBase = z.object({
  text: z
    .object({
      value: z.string(),
      start: z.number().int(),
      end: z.number().int(),
    })
    .meta({
      ref: "FilePartSourceText",
    }),
});

export const FileSource = FilePartSourceBase.extend({
  type: z.literal("file"),
  path: z.string(),
}).meta({
  ref: "FileSource",
});

export const SymbolSource = FilePartSourceBase.extend({
  type: z.literal("symbol"),
  path: z.string(),
  range: z.object({
    start: z.object({
      line: z.number(),
      character: z.number(),
    }),
    end: z.object({
      line: z.number(),
      character: z.number(),
    }),
  }),
  name: z.string(),
  kind: z.number().int(),
}).meta({
  ref: "SymbolSource",
});

export const ResourceSource = FilePartSourceBase.extend({
  type: z.literal("resource"),
  clientName: z.string(),
  uri: z.string(),
}).meta({
  ref: "ResourceSource",
});

export const FilePartSource = z
  .discriminatedUnion("type", [FileSource, SymbolSource, ResourceSource])
  .meta({
    ref: "FilePartSource",
  });
export type FilePartSource = z.infer<typeof FilePartSource>;

/**
 * File part - file attachment/embedding
 */
export const FilePart = PartBase.extend({
  type: z.literal("file"),
  mime: z.string(),
  filename: z.string().optional(),
  url: z.string(),
  source: FilePartSource.optional(),
}).meta({
  ref: "FilePart",
});
export type FilePart = z.infer<typeof FilePart>;

/**
 * Agent part - @agent mention metadata
 */
export const AgentPart = PartBase.extend({
  type: z.literal("agent"),
  name: z.string(),
  source: z
    .object({
      value: z.string(),
      start: z.number().int(),
      end: z.number().int(),
    })
    .optional(),
}).meta({
  ref: "AgentPart",
});
export type AgentPart = z.infer<typeof AgentPart>;

/**
 * Compaction marker part
 */
export const CompactionPart = PartBase.extend({
  type: z.literal("compaction"),
  auto: z.boolean(),
}).meta({
  ref: "CompactionPart",
});
export type CompactionPart = z.infer<typeof CompactionPart>;

/**
 * Subtask delegation part
 */
export const SubtaskPart = PartBase.extend({
  type: z.literal("subtask"),
  prompt: z.string(),
  description: z.string(),
  agent: z.string(),
  model: z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional(),
  command: z.string().optional(),
}).meta({
  ref: "SubtaskPart",
});
export type SubtaskPart = z.infer<typeof SubtaskPart>;

/**
 * Retry attempt marker part
 */
export const RetryPart = PartBase.extend({
  type: z.literal("retry"),
  attempt: z.number(),
  next: z.number().optional(),
  error: z.object({
    message: z.string(),
    statusCode: z.number().optional(),
    isRetryable: z.boolean(),
    responseHeaders: z.record(z.string(), z.string()).optional(),
    responseBody: z.string().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
  }),
  time: z.object({
    created: z.number(),
  }),
}).meta({
  ref: "RetryPart",
});
export type RetryPart = z.infer<typeof RetryPart>;

/**
 * Step start part - beginning of a workflow step
 */
export const StepStartPart = PartBase.extend({
  type: z.literal("step-start"),
  snapshot: z.string().optional(),
}).meta({
  ref: "StepStartPart",
});
export type StepStartPart = z.infer<typeof StepStartPart>;

/**
 * Step finish part - completion of a workflow step with usage stats
 */
export const StepFinishPart = PartBase.extend({
  type: z.literal("step-finish"),
  reason: z.string(),
  snapshot: z.string().optional(),
  cost: z.number(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cache: z.object({
      read: z.number(),
      write: z.number(),
    }),
  }),
}).meta({
  ref: "StepFinishPart",
});
export type StepFinishPart = z.infer<typeof StepFinishPart>;

/**
 * Error part - error information
 */
export const ErrorPart = PartBase.extend({
  type: z.literal("error"),
  message: z.string(),
  details: z.string().optional(),
  stack: z.string().optional(),
}).meta({
  ref: "ErrorPart",
});
export type ErrorPart = z.infer<typeof ErrorPart>;

/**
 * Snapshot part - code/state snapshot
 */
export const SnapshotPart = PartBase.extend({
  type: z.literal("snapshot"),
  snapshot: z.string(),
}).meta({
  ref: "SnapshotPart",
});
export type SnapshotPart = z.infer<typeof SnapshotPart>;

/**
 * Patch part - file patch/diff information
 */
export const PatchPart = PartBase.extend({
  type: z.literal("patch"),
  hash: z.string(),
  files: z.string().array(),
}).meta({
  ref: "PatchPart",
});
export type PatchPart = z.infer<typeof PatchPart>;

/**
 * Discriminated union of all part types
 * Use this for type-safe part handling
 */
export const Part = z
  .discriminatedUnion("type", [
    TextPart,
    SubtaskPart,
    ReasoningPart,
    ToolPart,
    FilePart,
    StepStartPart,
    StepFinishPart,
    ErrorPart,
    SnapshotPart,
    PatchPart,
    AgentPart,
    RetryPart,
    CompactionPart,
  ])
  .meta({
    ref: "Part",
  });
export type Part = z.infer<typeof Part>;

/**
 * Message info - user or assistant message metadata
 */
export const UserInfo = z
  .object({
    role: z.literal("user"),
    id: z.string(),
    sessionID: z.string().optional(),
    time: z
      .object({
        created: z.number(),
      })
      .optional(),
    agent: z.string().optional(),
    model: z
      .object({
        providerID: z.string(),
        modelID: z.string(),
      })
      .optional(),
    system: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional(),
    variant: z.string().optional(),
  })
  .meta({
    ref: "UserInfo",
  });
export type UserInfo = z.infer<typeof UserInfo>;

export const AssistantInfo = z
  .object({
    role: z.literal("assistant"),
    id: z.string(),
    sessionID: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    time: z
      .object({
        created: z.number(),
        completed: z.number().optional(),
      })
      .optional(),
    error: z.record(z.string(), z.unknown()).optional(),
    parentID: z.string().optional(),
    modelID: z.string().optional(),
    providerID: z.string().optional(),
    mode: z.string().optional(),
    agent: z.string().optional(),
    path: z
      .object({
        cwd: z.string(),
        root: z.string(),
      })
      .optional(),
    summary: z.boolean().optional(),
    cost: z.number().optional(),
    tokens: z
      .object({
        input: z.number(),
        output: z.number(),
        reasoning: z.number(),
        cache: z.object({
          read: z.number(),
          write: z.number(),
        }),
      })
      .optional(),
    finish: z.string().optional(),
  })
  .meta({
    ref: "AssistantInfo",
  });
export type AssistantInfo = z.infer<typeof AssistantInfo>;

export const SystemInfo = z
  .object({
    role: z.literal("system"),
    id: z.string(),
  })
  .meta({
    ref: "SystemInfo",
  });
export type SystemInfo = z.infer<typeof SystemInfo>;

export const MessageInfo = z.discriminatedUnion("role", [UserInfo, AssistantInfo, SystemInfo]);
export type MessageInfo = z.infer<typeof MessageInfo>;

/**
 * Message - complete message with info and parts array
 */
export const Message = z
  .object({
    info: MessageInfo,
    parts: Part.array(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
  })
  .meta({
    ref: "Message",
  });
export type Message = z.infer<typeof Message>;

/**
 * User message helper
 */
export function createUserMessage(params: {
  id: string;
  parts: Part[];
  createdAt?: number;
}): Message {
  return {
    info: { role: "user", id: params.id },
    parts: params.parts,
    createdAt: params.createdAt ?? Date.now(),
  };
}

/**
 * Assistant message helper
 */
export function createAssistantMessage(params: {
  id: string;
  model?: string;
  provider?: string;
  parts: Part[];
  createdAt?: number;
}): Message {
  return {
    info: { role: "assistant", id: params.id, model: params.model, provider: params.provider },
    parts: params.parts,
    createdAt: params.createdAt ?? Date.now(),
  };
}

/**
 * System message helper
 */
export function createSystemMessage(params: {
  id: string;
  parts: Part[];
  createdAt?: number;
}): Message {
  return {
    info: { role: "system", id: params.id },
    parts: params.parts,
    createdAt: params.createdAt ?? Date.now(),
  };
}
