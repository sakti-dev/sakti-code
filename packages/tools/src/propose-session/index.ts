import type { AgentTool } from "@sakti-code/agent";
import { type Static, Type } from "typebox";

const proposeSessionSchema = Type.Object({
  message: Type.String({
    description:
      "The pre-filled first message for the task session. This should contain the full context, requirements, and rough plan discussed with the user.",
  }),
  title: Type.String({
    description: "A short title for the task session",
  }),
});

export type ProposeSessionToolInput = Static<typeof proposeSessionSchema>;

export function createProposeSessionTool(): AgentTool<
  typeof proposeSessionSchema,
  undefined
> {
  return {
    name: "propose_session",
    label: "propose_session",
    description: `Call this tool when you and the user have agreed on a plan for a new feature, bug fix, or change. This creates a proposal for a new task session with a pre-filled message. The user will be asked to confirm before the session is created. Always call this tool as the LAST action in your turn — it terminates your run. The "message" field should be a complete, self-contained brief that a fresh agent (with no prior context) can understand and act on.`,
    parameters: proposeSessionSchema,
    async execute() {
      return {
        content: [
          {
            type: "text" as const,
            text: "Session proposed. Awaiting user confirmation.",
          },
        ],
        details: undefined,
        terminate: true,
      };
    },
  };
}
