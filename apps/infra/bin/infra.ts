import { App } from "aws-cdk-lib";

import { GoApiImageStack } from "../lib/go-api-image-stack";

const app = new App();

function requiredContext(key: string): string {
  const value: unknown = app.node.tryGetContext(key);
  if (typeof value !== "string" || value === "") {
    throw new Error(`Missing CDK context "${key}" (set it in cdk.json or pass -c ${key}=...)`);
  }
  return value;
}

/** Context values passed with -c arrive as strings; cdk.json may hold booleans. */
function booleanContext(key: string): boolean {
  const value: unknown = app.node.tryGetContext(key);
  return value === true || value === "true";
}

new GoApiImageStack(app, "GoApiImageStack", {
  // Account and region come from the deploying credentials (AWS_PROFILE / AWS_REGION).
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  githubRepository: requiredContext("githubRepository"),
  githubBranch: requiredContext("githubBranch"),
  repositoryName: requiredContext("goApiRepositoryName"),
  githubConnectionReady: booleanContext("githubConnectionReady"),
});
