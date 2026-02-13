/**
 * Chat Area Components Export
 */

import "./chat-area.css";

export { BasicTool, type BasicToolProps, type TriggerTitle } from "./basic-tool";
export { Part, type MessagePartProps } from "./message-part";
export { MessageTimeline, type MessageTimelineProps } from "./message-timeline";
export {
  clearPartRegistry,
  getPartComponent,
  hasPartComponent,
  registerPartComponent,
} from "./part-registry";
export type { PartComponent, PartProps } from "./part-registry";
export { SessionPromptDock, type SessionPromptDockProps } from "./session-prompt-dock";
export { SessionTurn, type SessionTurnProps } from "./session-turn";
export {
  clearToolRegistry,
  getToolRenderer,
  hasToolRenderer,
  registerToolRenderer,
} from "./tool-registry";
export type { ToolRenderer, ToolRendererProps } from "./tool-registry";

// Part components
export { ReasoningPart, type ReasoningPartProps } from "./parts/reasoning-part";
export { TEXT_RENDER_THROTTLE_MS, TextPart, type TextPartProps } from "./parts/text-part";
export { ToolPart, type ToolPartProps } from "./parts/tool-part";

// Registration helper
export { registerDefaultPartComponents } from "./register-parts";
