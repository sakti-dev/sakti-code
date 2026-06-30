import { createServer } from "./create-server.ts";

const sakti = await createServer();

console.log(`sakti-code server on ${sakti.url}`);

function shutdown(signal: string): void {
  console.log(`\n${signal} received — shutting down...`);
  void sakti.stop();
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
