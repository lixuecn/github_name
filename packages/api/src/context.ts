import type { Session } from "@my-better-t-app/auth";
import type { Database } from "@my-better-t-app/db";

export type Context = {
  session: Session | null;
  db: Database;
};
