/**
 * Event Ordering Fixtures
 *
 * Fixtures for testing event ordering edge cases in the render pipeline.
 * These represent scenarios that can cause "typing dots only" or missing content.
 *
 * @package @sakti-code/shared
 */

import type { AllServerEvents } from "../../event-types";

// UUIDv7 format IDs for consistent testing
const SESSION_ID = "0194e2c0-5c7a-7b8c-9d0e-1f2a3b4c5d6e";
const USER_MESSAGE_ID = "0194e2c0-5c7a-7b8c-9d0e-1f2a3b4c5d6f";
const ASSISTANT_MESSAGE_ID = "0194e2c0-5c7a-7b8c-9d0e-1f2a3b4c5d70";
const PART_ID_1 = "0194e2c0-5c7a-7b8c-9d0e-1f2a3b4c5d71";
const PART_ID_2 = "0194e2c0-5c7a-7b8c-9d0e-1f2a3b4c5d72";

/**
 * Event ordering fixture structure
 */
export interface EventOrderingFixture {
  name: string;
  description: string;
  sessionId: string;
  events: AllServerEvents[];
  expectedBehavior: {
    userMessageVisible: boolean;
    assistantContentVisible: boolean;
    typingIndicatorVisible: boolean;
    hasError: boolean;
  };
}

// Helper to create integrity fields
const createIntegrity = (
  sequence: number
): { eventId: string; sequence: number; timestamp: number } => ({
  // Deterministic UUIDv7-like identifier so strict guards pass in tests.
  eventId: `0194e2c0-5c7a-7b8c-9d0e-${sequence.toString(16).padStart(12, "0")}`,
  sequence,
  timestamp: 1704067200000 + sequence * 100,
});

/**
 * In-order fixture
 * Normal flow: user message → assistant message → parts
 * Expected: Everything renders correctly
 */
export const inOrderFixture: EventOrderingFixture = {
  name: "in-order",
  description: "Normal event ordering: user → assistant → parts",
  sessionId: SESSION_ID,
  events: [
    {
      type: "session.created",
      properties: {
        sessionID: SESSION_ID,
        directory: "/test/workspace",
      },
      sessionID: SESSION_ID,
      ...createIntegrity(1),
    },
    {
      type: "message.updated",
      properties: {
        info: {
          role: "user",
          id: USER_MESSAGE_ID,
          sessionID: SESSION_ID,
          content: "Hello, can you help me?",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(2),
    },
    {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          id: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          parentId: USER_MESSAGE_ID,
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(3),
    },
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: PART_ID_1,
          messageID: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          text: "I'd be happy to help!",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(4),
    },
  ],
  expectedBehavior: {
    userMessageVisible: true,
    assistantContentVisible: true,
    typingIndicatorVisible: false,
    hasError: false,
  },
};

/**
 * Part before message fixture
 * Part arrives before its parent message is created
 * Tests: Skeleton state, reactive update when message arrives
 */
export const partBeforeMessageFixture: EventOrderingFixture = {
  name: "part-before-message",
  description: "Part arrives before parent message exists",
  sessionId: SESSION_ID,
  events: [
    {
      type: "message.updated",
      properties: {
        info: {
          role: "user",
          id: USER_MESSAGE_ID,
          sessionID: SESSION_ID,
          content: "Hello",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(1),
    },
    // Part arrives BEFORE assistant message
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: PART_ID_1,
          messageID: ASSISTANT_MESSAGE_ID, // References non-existent message
          sessionID: SESSION_ID,
          text: "Hello there!",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(2),
    },
    // Assistant message arrives later
    {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          id: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          parentId: USER_MESSAGE_ID,
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(3),
    },
  ],
  expectedBehavior: {
    userMessageVisible: true,
    assistantContentVisible: true, // Should show once message arrives
    typingIndicatorVisible: false,
    hasError: false,
  },
};

/**
 * Assistant before user fixture
 * Assistant message created before user message
 * Tests: Window-based fallback selection, parentId linkage
 */
export const assistantBeforeUserFixture: EventOrderingFixture = {
  name: "assistant-before-user",
  description: "Assistant message created before user message",
  sessionId: SESSION_ID,
  events: [
    // Assistant created first (orphaned)
    {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          id: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          parentId: USER_MESSAGE_ID, // References non-existent user message
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(1),
    },
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: PART_ID_1,
          messageID: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          text: "I can help with that!",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(2),
    },
    // User message arrives later
    {
      type: "message.updated",
      properties: {
        info: {
          role: "user",
          id: USER_MESSAGE_ID,
          sessionID: SESSION_ID,
          content: "Help me please",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(3),
    },
  ],
  expectedBehavior: {
    userMessageVisible: true,
    assistantContentVisible: true, // Should render via window-based fallback
    typingIndicatorVisible: false,
    hasError: false,
  },
};

/**
 * Partial stream fixture
 * Content arrives incrementally during streaming
 * Tests: Content-priority typing indicator (content hides typing)
 */
export const partialStreamFixture: EventOrderingFixture = {
  name: "partial-stream",
  description: "Content arrives incrementally while streaming",
  sessionId: SESSION_ID,
  events: [
    {
      type: "message.updated",
      properties: {
        info: {
          role: "user",
          id: USER_MESSAGE_ID,
          sessionID: SESSION_ID,
          content: "Tell me a story",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(1),
    },
    {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          id: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          parentId: USER_MESSAGE_ID,
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(2),
    },
    // First part arrives (should hide typing)
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: PART_ID_1,
          messageID: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          text: "Once upon a time",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(3),
    },
    // More content while still generating
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: PART_ID_2,
          messageID: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          text: " in a land far away...",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(4),
    },
    // Session status still shows running
    {
      type: "session.status",
      properties: {
        sessionID: SESSION_ID,
        status: { type: "busy" },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(5),
    },
  ],
  expectedBehavior: {
    userMessageVisible: true,
    assistantContentVisible: true,
    typingIndicatorVisible: false, // Content hides typing even while busy
    hasError: false,
  },
};

/**
 * Error with content fixture
 * Stream errors but partial content exists
 * Tests: Error state shows partial content
 */
export const errorWithContentFixture: EventOrderingFixture = {
  name: "error-with-content",
  description: "Stream errors but partial content should still render",
  sessionId: SESSION_ID,
  events: [
    {
      type: "message.updated",
      properties: {
        info: {
          role: "user",
          id: USER_MESSAGE_ID,
          sessionID: SESSION_ID,
          content: "Generate code",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(1),
    },
    {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          id: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          parentId: USER_MESSAGE_ID,
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(2),
    },
    // Partial content arrives
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: PART_ID_1,
          messageID: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          text: "Here's the code:",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(3),
    },
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "code",
          id: PART_ID_2,
          messageID: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          code: "function example() {\n  // partial code",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(4),
    },
    // Error occurs
    {
      type: "session.status",
      properties: {
        sessionID: SESSION_ID,
        status: {
          type: "retry",
          attempt: 1,
          message: "Model timeout",
          next: 5000,
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(5),
    },
  ],
  expectedBehavior: {
    userMessageVisible: true,
    assistantContentVisible: true, // Partial content should still show
    typingIndicatorVisible: false,
    hasError: true,
  },
};

/**
 * Missing parts fixture
 * Message exists but no parts yet
 * Tests: Skeleton state, loading indicator
 */
export const missingPartsFixture: EventOrderingFixture = {
  name: "missing-parts",
  description: "Assistant message exists but parts haven't arrived",
  sessionId: SESSION_ID,
  events: [
    {
      type: "message.updated",
      properties: {
        info: {
          role: "user",
          id: USER_MESSAGE_ID,
          sessionID: SESSION_ID,
          content: "Hello",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(1),
    },
    {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          id: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          parentId: USER_MESSAGE_ID,
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(2),
    },
    {
      type: "session.status",
      properties: {
        sessionID: SESSION_ID,
        status: { type: "busy" },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(3),
    },
    // No parts yet - message exists but empty
  ],
  expectedBehavior: {
    userMessageVisible: true,
    assistantContentVisible: false, // No content yet
    typingIndicatorVisible: true, // Should show typing while waiting
    hasError: false,
  },
};

/**
 * Tool call content fixture
 * Tool calls count as content (should hide typing)
 * Tests: Tool calls are treated as content
 */
export const toolCallContentFixture: EventOrderingFixture = {
  name: "tool-call-content",
  description: "Tool calls should count as content and hide typing",
  sessionId: SESSION_ID,
  events: [
    {
      type: "message.updated",
      properties: {
        info: {
          role: "user",
          id: USER_MESSAGE_ID,
          sessionID: SESSION_ID,
          content: "Read package.json",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(1),
    },
    {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          id: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          parentId: USER_MESSAGE_ID,
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(2),
    },
    // Tool call arrives (counts as content)
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool-call",
          id: PART_ID_1,
          messageID: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          toolCallId: "call_123",
          toolName: "read_file",
          args: { path: "/package.json" },
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(3),
    },
    // Still generating (tool result pending)
    {
      type: "session.status",
      properties: {
        sessionID: SESSION_ID,
        status: { type: "busy" },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(4),
    },
  ],
  expectedBehavior: {
    userMessageVisible: true,
    assistantContentVisible: true, // Tool call counts as content
    typingIndicatorVisible: false, // Hidden because tool call exists
    hasError: false,
  },
};

/**
 * Invalid parentId fixture
 * Assistant has parentId that doesn't match any user message
 * Tests: Graceful degradation, window-based fallback
 */
export const invalidParentIdFixture: EventOrderingFixture = {
  name: "invalid-parentId",
  description: "Assistant has invalid parentId reference",
  sessionId: SESSION_ID,
  events: [
    {
      type: "message.updated",
      properties: {
        info: {
          role: "user",
          id: USER_MESSAGE_ID,
          sessionID: SESSION_ID,
          content: "Hello",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(1),
    },
    {
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          id: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          parentId: "invalid-parent-id", // Wrong parentId
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(2),
    },
    {
      type: "message.part.updated",
      properties: {
        part: {
          type: "text",
          id: PART_ID_1,
          messageID: ASSISTANT_MESSAGE_ID,
          sessionID: SESSION_ID,
          text: "Response with wrong parentId",
        },
      },
      sessionID: SESSION_ID,
      ...createIntegrity(3),
    },
  ],
  expectedBehavior: {
    userMessageVisible: true,
    assistantContentVisible: true, // Should render via window fallback
    typingIndicatorVisible: false,
    hasError: false,
  },
};

/**
 * All fixtures export
 */
export const allEventOrderingFixtures: EventOrderingFixture[] = [
  inOrderFixture,
  partBeforeMessageFixture,
  assistantBeforeUserFixture,
  partialStreamFixture,
  errorWithContentFixture,
  missingPartsFixture,
  toolCallContentFixture,
  invalidParentIdFixture,
];

/**
 * Get fixture by name
 */
export function getEventOrderingFixture(name: string): EventOrderingFixture | undefined {
  return allEventOrderingFixtures.find(f => f.name === name);
}

/**
 * Get fixtures by category
 */
export const eventOrderingCategories = {
  normal: [inOrderFixture],
  edgeCases: [partBeforeMessageFixture, assistantBeforeUserFixture, invalidParentIdFixture],
  streaming: [partialStreamFixture, missingPartsFixture, toolCallContentFixture],
  errors: [errorWithContentFixture],
};
