import type { App } from "@sakti-code/server";
import { hc } from "hono/client";

export type Client = ReturnType<typeof hc<App>>;

export const api = (...args: Parameters<typeof hc>): Client => hc<App>(...args);
