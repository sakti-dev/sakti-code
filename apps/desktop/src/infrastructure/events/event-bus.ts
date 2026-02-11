/**
 * Event Bus
 *
 * Typed pub/sub event system for application events.
 * Wraps @solid-primitives/event-bus with type safety.
 */

import type { ServerEvent } from "@ekacode/shared/event-types";
import { createGlobalEmitter } from "@solid-primitives/event-bus";

type TypedEvent = ServerEvent;

export type TypedEventBus = ReturnType<typeof createTypedEventBus>;

export function createTypedEventBus() {
  const emitter = createGlobalEmitter<Record<string, TypedEvent>>();

  return {
    /**
     * Subscribe to events for a directory
     */
    listen: (directory: string, callback: (event: TypedEvent) => void) => {
      return emitter.listen(e => {
        if (e.name === directory) {
          callback(e.details);
        }
      });
    },

    /**
     * Emit an event to a directory
     */
    emit: (directory: string, event: TypedEvent) => {
      emitter.emit(directory, event);
    },

    /**
     * Subscribe to global events
     */
    listenGlobal: (callback: (event: TypedEvent) => void) => {
      return emitter.listen(e => {
        callback(e.details);
      });
    },
  };
}
