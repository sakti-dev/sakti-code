import type { PromptTemplate } from "@sakti-code/agent";

/**
 * Builtin slash commands handled at the WS layer (not file-based prompt
 * templates). These are advertised in the context endpoint so the
 * autocomplete `/` menu shows them alongside project commands.
 */
export const BUILTIN_COMMANDS: PromptTemplate[] = [
  {
    name: "compact",
    description: "Compact context — summarize history or force-reflect observations",
    content: "",
  },
];
