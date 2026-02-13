/**
 * Register Default Part Components
 *
 * Registers the default part components for text, reasoning, tool, permission, and question types.
 * Call this function during app initialization to set up the part registry.
 */

import { registerPartComponent } from "./part-registry";
import { PermissionPart } from "./parts/permission-part";
import { QuestionPart } from "./parts/question-part";
import { ReasoningPart } from "./parts/reasoning-part";
import { RetryPart } from "./parts/retry-part";
import { TextPart } from "./parts/text-part";
import { ToolPart } from "./parts/tool-part";

let registered = false;

/**
 * Register default part components for the chat area.
 * Safe to call multiple times - will only register once.
 */
export function registerDefaultPartComponents(): void {
  if (registered) return;

  registerPartComponent("text", TextPart);
  registerPartComponent("reasoning", ReasoningPart);
  registerPartComponent("tool", ToolPart);
  registerPartComponent("permission", PermissionPart);
  registerPartComponent("question", QuestionPart);
  registerPartComponent("retry", RetryPart);

  registered = true;
}

/**
 * Reset registration state (for testing)
 */
export function resetRegistration(): void {
  registered = false;
}
