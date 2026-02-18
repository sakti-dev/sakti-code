/**
 * Spec Context Injection
 *
 * Phase 4 - Spec System
 * Injects spec context into agent messages for build mode
 */

import type { ModelMessage } from "ai";
import { promises as fs } from "fs";
import path from "path";
import type { Message } from "../chat/message-v2";
import { Instance } from "../instance";
import {
  getActiveSpec,
  getCurrentTask,
  getTaskBySpecAndId,
  listTasksBySpec,
} from "../spec/helpers";

interface SpecMessage {
  info: { role: "system"; id: string };
  parts: Array<{ id: string; sessionID: string; messageID: string; type: "text"; text: string }>;
  metadata?: Record<string, unknown>;
}

interface SpecContextData {
  activeSpec: string;
  text: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Get full requirement text from requirements.md
 */
async function getRequirementText(specSlug: string, reqId: string): Promise<string> {
  const instanceContext = Instance.context;
  if (!instanceContext) {
    return reqId;
  }

  const specDir = path.join(instanceContext.directory, ".kiro", "specs", specSlug);
  const reqFile = path.join(specDir, "requirements.md");

  try {
    const content = await fs.readFile(reqFile, "utf-8");
    const escapedReqId = escapeRegExp(reqId);
    const reqMatch = content.match(
      new RegExp(`- ${escapedReqId}\\s*\\n?\\s*WHEN.*?THEN.*?(?=\\n- R-|\\n##|$)`, "is")
    );
    if (reqMatch) {
      return reqMatch[0].replace(/\n/g, " ").trim();
    }
    const simpleMatch = content.match(
      new RegExp(`### ${escapedReqId}\\s*\\n?\\s*(.+?)(?=\\n###|\\n##|$)`, "is")
    );
    if (simpleMatch) {
      return simpleMatch[1].trim();
    }
  } catch {
    // File doesn't exist
  }

  return reqId;
}

async function buildSpecContext(sessionId: string): Promise<SpecContextData | null> {
  const activeSpec = await getActiveSpec(sessionId);
  const currentTaskId = await getCurrentTask(sessionId);
  if (!activeSpec) {
    return null;
  }

  let specContext = "";

  if (currentTaskId) {
    const task = await getTaskBySpecAndId(activeSpec, currentTaskId);
    if (task) {
      const taskMeta = task.metadata as Record<string, unknown> | null;
      const spec = taskMeta?.spec as Record<string, unknown> | null;

      specContext += `## Current Task: ${spec?.taskId}\n`;
      specContext += `**Title:** ${task.title}\n`;

      const requirements = spec?.requirements as string[] | null;
      if (requirements && requirements.length > 0) {
        specContext += `**Requirements:**\n`;
        for (const reqId of requirements) {
          const reqText = await getRequirementText(activeSpec, reqId);
          specContext += `- ${reqId}: ${reqText}\n`;
        }
        specContext += `\n`;
      }

      if (task.description) {
        specContext += `**Outcome:** ${task.description}\n\n`;
      }

      const taskIndex = await listTasksBySpec(activeSpec);
      if (taskIndex.length > 0) {
        specContext += `**Spec Task Index:**\n`;
        for (const t of taskIndex) {
          const tMeta = t.metadata as Record<string, unknown> | null;
          const tSpec = tMeta?.spec as Record<string, unknown> | null;
          const status = t.status === "closed" ? "✓" : t.status === "in_progress" ? "→" : "○";
          specContext += `${status} ${tSpec?.taskId}: ${t.title}\n`;
        }
        specContext += `\n`;
      }
    }
  }

  specContext += `**Memory Search:** Use memory-search tool to retrieve exact details from previous work.\n`;

  return {
    activeSpec,
    text: specContext,
  };
}

/**
 * Injects spec context into messages
 * CRITICAL: Injects AFTER observational memory chain (continuation hint is user message)
 */
export async function injectSpecContext(
  messages: Message[],
  sessionId: string
): Promise<Message[]> {
  const context = await buildSpecContext(sessionId);
  if (!context) {
    return messages;
  }

  const specMessage: SpecMessage = {
    info: { role: "system", id: `spec-context-${Date.now()}` },
    parts: [
      {
        id: `part-${Date.now()}`,
        sessionID: sessionId,
        messageID: `msg-${Date.now()}`,
        type: "text",
        text: context.text,
      },
    ],
    metadata: { type: "spec-context", specSlug: context.activeSpec },
  };

  const continuationHintIndex = messages.findIndex(
    m =>
      m.info.role === "user" &&
      (m as unknown as { metadata?: { type?: string } }).metadata?.type === "memory-continuation"
  );

  if (continuationHintIndex >= 0) {
    messages.splice(continuationHintIndex + 1, 0, specMessage as Message);
  } else {
    const baseSystemIndex = messages.findIndex(m => m.info.role === "system");
    if (baseSystemIndex >= 0) {
      messages.splice(baseSystemIndex + 1, 0, specMessage as Message);
    } else {
      messages.unshift(specMessage as Message);
    }
  }

  return messages;
}

export async function injectSpecContextForModelMessages(
  messages: ModelMessage[],
  sessionId: string
): Promise<ModelMessage[]> {
  const context = await buildSpecContext(sessionId);
  if (!context) {
    return messages;
  }

  const lastUserIndex = [...messages].reverse().findIndex(message => message.role === "user");
  const insertionIndex =
    lastUserIndex >= 0 ? messages.length - 1 - lastUserIndex : Math.max(0, messages.length - 1);

  messages.splice(insertionIndex, 0, {
    role: "system",
    content: context.text,
  });

  return messages;
}
