// Runs a local PostgreSQL for development and tests, using the credentials and
// port from DATABASE_URL. Data persists in packages/db/.local-postgres.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";

const DEFAULT_PORT = 5432;

const url = new URL(process.env.DATABASE_URL);
const port = Number(url.port || DEFAULT_PORT);
const databaseDir = fileURLToPath(new URL("../.local-postgres", import.meta.url));

const postgres = new EmbeddedPostgres({
  databaseDir,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port,
  persistent: true,
});

if (!existsSync(databaseDir)) {
  await postgres.initialise();
}
await postgres.start();
console.log(`Local PostgreSQL is running on port ${port}`);

const stop = async () => {
  await postgres.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
