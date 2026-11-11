import { App } from "aws-cdk-lib";

import { GoApiImageStack } from "../lib/go-api-image-stack";
import { type ExistingNetwork, GoApiServiceStack } from "../lib/go-api-service-stack";

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

function optionalStringContext(key: string): string | undefined {
  const value: unknown = app.node.tryGetContext(key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function networkContext(): ExistingNetwork {
  const value: unknown = app.node.tryGetContext("network");
  if (typeof value !== "object" || value === null) {
    throw new Error('Missing CDK context "network" (see cdk.json)');
  }
  return value as ExistingNetwork;
}

// Account and region come from the deploying credentials (AWS_PROFILE / AWS_REGION).
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};
const repositoryName = requiredContext("goApiRepositoryName");

new GoApiImageStack(app, "GoApiImageStack", {
  env,
  githubRepository: requiredContext("githubRepository"),
  githubBranch: requiredContext("githubBranch"),
  repositoryName,
  githubConnectionReady: booleanContext("githubConnectionReady"),
});

new GoApiServiceStack(app, "GoApiServiceStack", {
  env,
  network: networkContext(),
  repositoryName,
  // Deploy a specific build with: -c goApiImageTag=<commit sha>
  imageTag: optionalStringContext("goApiImageTag"),
  desiredCount: Number(app.node.tryGetContext("goApiDesiredCount") ?? 1),
  databaseUrlSecretName: requiredContext("goApiDatabaseUrlSecretName"),
});
