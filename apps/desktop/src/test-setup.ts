import { afterEach } from "vitest";
import { cleanup } from "@solidjs/testing-library";

// jsdom throws InvalidNodeTypeError when SolidJS's async reactive disposal
// tries to remove DOM nodes that Kobalte Portals already detached. This
// happens after afterEach completes (async microtask), so try-catch in
// afterEach can't catch it. Filter it at the process level.
process.on("uncaughtException", (err) => {
  if (err instanceof Error && err.name === "InvalidNodeTypeError") {
    return;
  }
  throw err;
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  cleanup();
});
