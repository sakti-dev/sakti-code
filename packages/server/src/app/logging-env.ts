import { resolve } from "node:path";

if (process.env.NODE_ENV !== "production") {
  process.env.LOG_FILE_PATH ||= resolve(process.cwd(), "logs/server-dev.log");
  process.env.LOG_FILE_OUTPUT ||= "true";
}
