import { treaty } from "@elysiajs/eden";
import type { App } from "@sakti-code/server";

export const api = treaty<App>("http://localhost:3001");
