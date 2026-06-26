export interface Trigger {
  char: "/" | "@";
  index: number;
}

/**
 * Given the textarea value AFTER an input and the current caret position,
 * return the trigger if the char just typed (at caret-1) is a trigger at a
 * valid position: `/` only at index 0, `@` anywhere. Called from chat-input's
 * onInput.
 */
export function detectTrigger(value: string, caret: number): Trigger | null {
  if (caret <= 0) {
    return null;
  }
  const index = caret - 1;
  const char = value[index];
  if (char === "/") {
    return index === 0 ? { char: "/", index: 0 } : null;
  }
  if (char === "@") {
    return { char: "@", index };
  }
  return null;
}
