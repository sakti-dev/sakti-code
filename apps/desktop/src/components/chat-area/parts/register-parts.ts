import { CompactionPart } from "./compaction-part.tsx";
import { OmMarkerPart } from "./om-marker-part.tsx";
import { registerPartComponent } from "./part-registry.ts";
import { TextPart } from "./text-part.tsx";
import { ToolPart } from "./tool-part.tsx";

let registered = false;

export function registerDefaultPartComponents(): void {
  if (registered) {
    return;
  }

  registerPartComponent("text", TextPart);
  registerPartComponent("tool_call", ToolPart);
  registerPartComponent("om_marker", OmMarkerPart);
  registerPartComponent("compaction", CompactionPart);

  registered = true;
}

export function resetRegistration(): void {
  registered = false;
}
