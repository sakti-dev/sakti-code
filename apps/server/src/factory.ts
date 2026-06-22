import { createFactory } from "hono/factory";
import type { ServerContext } from "./context.ts";

export interface AppEnv {
  Variables: { ctx: ServerContext };
}

export const factory = createFactory<AppEnv>();
