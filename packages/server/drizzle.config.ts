/**
 * Drizzle Kit configuration
 */

import { resolveAppPaths } from "@sakti-code/shared/paths";
import type { Config } from "drizzle-kit";

const paths = resolveAppPaths();

export default {
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: paths.sakticodeDbUrl,
  },
} satisfies Config;
