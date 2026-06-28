import type { PlaygroundPreset } from "../types/playground";
import incremarkSolidExample from "./incremark-solid-example";

export const playgroundPresets: PlaygroundPreset[] = [
  {
    id: "incremark-solid-example",
    label: "Incremark Example",
    description:
      "Copied from the Incremark Solid example sample and expanded with a broader Mermaid section for renderer evaluation.",
    markdown: incremarkSolidExample,
  },
];
