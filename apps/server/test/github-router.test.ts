import { createPrismaProfileStore } from "@my-better-t-app/api/profile-store";

import { registerGithubRouterSuite } from "./github-router-suite";

// The github router against PostgreSQL through Prisma (local development mode).
registerGithubRouterSuite({ label: "prisma", createStore: createPrismaProfileStore });
