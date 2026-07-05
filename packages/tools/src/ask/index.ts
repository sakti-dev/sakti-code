import type { AgentTool } from "@sakti-code/agent";
import { type Static, Type } from "typebox";

const askSchema = Type.Object({
  kind: Type.Optional(
    Type.String({
      description:
        "Optional discriminator. Known kinds (session/spec/completion) present a confirmation card with wired actions; omit for an open question that the user answers in their next message.",
    }),
  ),
  body: Type.String({
    description:
      "The content to present to the user — a mission brief (kind=session), a detailed spec (kind=spec), a completion summary (kind=completion), or an open question (no kind). Always end your turn after calling ask; the user's response arrives as the next message.",
  }),
});

export type AskToolInput = Static<typeof askSchema>;

export function createAskTool(): AgentTool<typeof askSchema, undefined> {
  return {
    name: "ask",
    label: "ask",
    description:
      "Present something to the user and end your turn. Use a known kind (session/spec/completion) for a workflow gate with wired actions, or omit kind for an open question. The user's response arrives as the next message.",
    parameters: askSchema,
    async execute() {
      return {
        content: [{ type: "text" as const, text: "Awaiting user." }],
        details: undefined,
        terminate: true,
      };
    },
  };
}
