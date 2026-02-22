/**
 * Permission/Question Fixtures for Testing
 *
 * Provides test data for permission and question part component testing.
 */

import type { PermissionRequest, PermissionStatus } from "@/core/state/stores/permission-store";
import type { QuestionRequest, QuestionStatus } from "@/core/state/stores/question-store";
import type { Part } from "@sakti-code/shared/event-types";

// ============================================================================
// Permission Fixtures
// ============================================================================

/**
 * Create a permission request for testing
 */
export function createPermissionRequest(
  overrides?: Partial<PermissionRequest> & { status?: PermissionStatus }
): PermissionRequest {
  return {
    id: "permission-1",
    sessionID: "session-1",
    messageID: "message-1",
    toolName: "read",
    args: { path: "/src/index.ts" },
    description: "Read file /src/index.ts",
    status: "pending",
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Create a pending permission request
 */
export function createPendingPermissionRequest(
  overrides?: Partial<PermissionRequest>
): PermissionRequest {
  return createPermissionRequest({ ...overrides, status: "pending" });
}

/**
 * Create an approved permission request
 */
export function createApprovedPermissionRequest(
  overrides?: Partial<PermissionRequest>
): PermissionRequest {
  return createPermissionRequest({ ...overrides, status: "approved" });
}

/**
 * Create a denied permission request
 */
export function createDeniedPermissionRequest(
  overrides?: Partial<PermissionRequest>
): PermissionRequest {
  return createPermissionRequest({ ...overrides, status: "denied" });
}

/**
 * Create canonical flat permission part shape used in message parts
 */
export function createCanonicalPermissionPart(
  request: PermissionRequest,
  overrides?: Partial<Part>
): Part {
  return {
    id: `permission-part-${request.id}`,
    type: "permission",
    messageID: request.messageID,
    sessionID: request.sessionID,
    permissionId: request.id,
    toolName: request.toolName,
    args: request.args,
    description: request.description,
    status: request.status,
    timestamp: request.timestamp,
    ...overrides,
  } as Part;
}

// ============================================================================
// Question Fixtures
// ============================================================================

/**
 * Create a question request for testing
 */
export function createQuestionRequest(
  overrides?: Partial<QuestionRequest> & { status?: QuestionStatus }
): QuestionRequest {
  return {
    id: "question-1",
    sessionID: "session-1",
    messageID: "message-1",
    questions: [
      {
        header: "Question",
        question: "Which file should I read?",
      },
    ],
    question: "Which file should I read?",
    status: "pending",
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Create a pending question request
 */
export function createPendingQuestionRequest(
  overrides?: Partial<QuestionRequest>
): QuestionRequest {
  return createQuestionRequest({ ...overrides, status: "pending" });
}

/**
 * Create an answered question request
 */
export function createAnsweredQuestionRequest(
  answer?: unknown,
  overrides?: Partial<QuestionRequest>
): QuestionRequest {
  return createQuestionRequest({
    ...overrides,
    status: "answered",
    answer: answer ?? "src/index.ts",
  });
}

/**
 * Create a rejected question request
 */
export function createRejectedQuestionRequest(
  reason?: string,
  overrides?: Partial<QuestionRequest>
): QuestionRequest {
  return createQuestionRequest({
    ...overrides,
    status: "answered",
    answer: { rejected: true, reason: reason ?? "User skipped" },
  });
}

/**
 * Create a question with multiple choice options
 */
export function createMultipleChoiceQuestionRequest(
  options: string[],
  overrides?: Partial<QuestionRequest>
): QuestionRequest {
  return createQuestionRequest({
    ...overrides,
    questions: [
      {
        header: "Question",
        question: overrides?.question ?? "Which option should I choose?",
        options: options.map(label => ({ label })),
      },
    ],
    options,
  });
}

/**
 * Create canonical flat question part shape used in message parts
 */
export function createCanonicalQuestionPart(
  request: QuestionRequest,
  overrides?: Partial<Part>
): Part {
  return {
    id: `question-part-${request.id}`,
    type: "question",
    messageID: request.messageID,
    sessionID: request.sessionID,
    questionId: request.id,
    question: request.question,
    options: request.options,
    status: request.status,
    answer: request.answer,
    timestamp: request.timestamp,
    ...overrides,
  } as Part;
}

// ============================================================================
// Scenario Fixtures
// ============================================================================

/**
 * Create a complete permission scenario with all statuses
 */
export function createPermissionScenario(): {
  pending: PermissionRequest;
  approved: PermissionRequest;
  denied: PermissionRequest;
} {
  const base = {
    sessionID: "scenario-session",
    messageID: "scenario-message",
    toolName: "bash",
    args: { command: "npm run build" },
    description: "Run npm build command",
    timestamp: Date.now(),
  };

  return {
    pending: createPendingPermissionRequest({
      ...base,
      id: "permission-pending",
    }),
    approved: createApprovedPermissionRequest({
      ...base,
      id: "permission-approved",
    }),
    denied: createDeniedPermissionRequest({
      ...base,
      id: "permission-denied",
    }),
  };
}

/**
 * Create a complete question scenario with various states
 */
export function createQuestionScenario(): {
  pending: QuestionRequest;
  pendingWithOptions: QuestionRequest;
  answered: QuestionRequest;
  rejected: QuestionRequest;
} {
  const base = {
    sessionID: "scenario-session",
    messageID: "scenario-message",
    timestamp: Date.now(),
  };

  return {
    pending: createPendingQuestionRequest({
      ...base,
      id: "question-pending",
      question: "What file should I analyze?",
    }),
    pendingWithOptions: createMultipleChoiceQuestionRequest(
      ["src/index.ts", "src/utils.ts", "src/main.ts"],
      {
        ...base,
        id: "question-options",
        question: "Select a file to analyze:",
      }
    ),
    answered: createAnsweredQuestionRequest("src/index.ts", {
      ...base,
      id: "question-answered",
      question: "What file should I analyze?",
    }),
    rejected: createRejectedQuestionRequest("Not needed anymore", {
      ...base,
      id: "question-rejected",
      question: "Should I create a new file?",
    }),
  };
}
