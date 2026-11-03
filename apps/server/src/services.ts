import { createAuth } from "@my-better-t-app/auth";
import { createPrismaClient } from "@my-better-t-app/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);
