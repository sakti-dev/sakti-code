```ts
import { createSignal } from "solid-js";

type Status = "idle" | "streaming" | "done";

export function createSessionLabel(status: Status): string {
  if (status === "streaming") {
    return "Streaming response";
  }

  return `Session: ${status}`;
}
```
