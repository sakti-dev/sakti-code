import { Elysia } from "elysia";

interface Command {
  description: string;
  name: string;
  usage?: string;
}

function getCommands(): Command[] {
  return [
    {
      name: "search",
      description: "Search files in the project directory",
      usage: "/search <query>",
    },
    {
      name: "clear",
      description: "Clear the conversation history",
      usage: "/clear",
    },
    {
      name: "compact",
      description:
        "Summarize and compact the conversation history to save tokens",
      usage: "/compact",
    },
    {
      name: "help",
      description: "Show available commands and their usage",
      usage: "/help [command]",
    },
  ];
}

export const commandsRoutes = new Elysia({ name: "routes.commands" }).get(
  "/api/commands",
  () => Response.json({ commands: getCommands() })
);
