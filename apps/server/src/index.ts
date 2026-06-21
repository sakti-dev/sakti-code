import { Database } from "bun:sqlite";
import { initDatabase } from "@sakti-code/db";
import { app } from "./app.ts";
import { createContext } from "./context.ts";

const db = await initDatabase(
  new Database(process.env.SAKTI_DB_PATH ?? "sakti.db")
);
app
  .state("ctx", createContext(db))
  .compile()
  .listen(Number(process.env.SAKTI_PORT ?? 3001));
console.log(
  `sakti-code server on http://localhost:${process.env.SAKTI_PORT ?? 3001}`
);
