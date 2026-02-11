/**
 * Text Part Component - Throttled rendering
 *
 * Opencode-style text rendering with 100ms throttle to prevent UI jank
 * during rapid streaming updates.
 */

import type { TextPart as TextPartType } from "@ekacode/core/chat";
import { Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { Markdown } from "../markdown";
import type { MessagePartProps, PartComponent } from "../message-part";

/**
 * Text rendering throttle in milliseconds
 * Updates faster than 100ms are debounced to prevent excessive re-renders
 * Disabled in test environment for immediate rendering
 */
const TEXT_RENDER_THROTTLE_MS = import.meta.env.TEST ? 0 : 100;

/**
 * Create a throttled signal value
 *
 * Throttles rapid updates to a minimum of TEXT_RENDER_THROTTLE_MS.
 * This prevents UI jank during high-frequency streaming.
 *
 * @param getValue - Function that returns the current value
 * @returns Signal with throttled updates
 */
function createThrottledValue(getValue: () => string): () => string {
  const [value, setValue] = createSignal(getValue());
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let last = 0;

  createEffect(() => {
    const next = getValue();
    const now = Date.now();
    const remaining = TEXT_RENDER_THROTTLE_MS - (now - last);

    // If enough time has passed, update immediately
    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      last = now;
      setValue(next);
      return;
    }

    // Otherwise, schedule an update
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      last = Date.now();
      setValue(next);
      timeout = undefined;
    }, remaining);
  });

  onCleanup(() => {
    if (timeout) clearTimeout(timeout);
  });

  return value;
}

/**
 * Text part display component
 *
 * Renders text content with throttled updates.
 * The text is trimmed and rendered as markdown.
 */
export const TextPartDisplay: PartComponent = (props: MessagePartProps): JSX.Element => {
  const part = props.part as TextPartType;

  // Get the text content, default to empty string
  const getText = () => (part.text ?? "").trim();

  // Create throttled text signal
  const throttledText = createThrottledValue(getText);

  return (
    <Show when={throttledText()}>
      <div data-component="text-part">
        <div data-slot="text-content">
          <Markdown text={throttledText()} />
        </div>
      </div>
    </Show>
  );
};

// Export the createThrottledValue helper for use in other components
export { createThrottledValue };
