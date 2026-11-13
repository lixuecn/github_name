import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { App } from "aws-cdk-lib";

import { GoApiImageStack } from "../lib/go-api-image-stack";
import { type ExistingNetwork, GoApiServiceStack } from "../lib/go-api-service-stack";
import { MonitoringStack } from "../lib/monitoring-stack";
import { ServerStack } from "../lib/server-stack";

const SERVER_BUNDLE_DIR = fileURLToPath(new URL("../../server/dist/lambda", import.meta.url));

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

function stringListContext(key: string): string[] {
  const value: unknown = app.node.tryGetContext(key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
  githubRepository: requiredContext("goApiGithubRepository"),
  githubBranch: requiredContext("githubBranch"),
  sourceDir: requiredContext("goApiSourceDir"),
  repositoryName,
  githubConnectionReady: booleanContext("githubConnectionReady"),
  githubActionsPushUser: booleanContext("githubActionsPushUser"),
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

// ServerStack packages the built backend; skip it (rather than failing every
// stack) when the bundle is missing. `pnpm --filter infra deploy:server` builds first.
if (existsSync(`${SERVER_BUNDLE_DIR}/lambda.mjs`)) {
  new ServerStack(app, "ServerStack", {
    env,
    network: networkContext(),
    functionName: requiredContext("serverFunctionName"),
    codeDirectory: SERVER_BUNDLE_DIR,
    httpApiId: requiredContext("serverHttpApiId"),
    databaseUrlSecretName: requiredContext("serverDatabaseUrlSecretName"),
    corsOrigin: requiredContext("serverCorsOrigin"),
    goApiUrl: optionalStringContext("serverGoApiUrl"),
    extraRollbackAlarmNames: stringListContext("serverExtraRollbackAlarmNames"),
  });
} else {
  process.stderr.write(
    `ServerStack skipped: no backend bundle at ${SERVER_BUNDLE_DIR} (run \`pnpm --filter server build:lambda\`).\n`
  );
}

new MonitoringStack(app, "MonitoringStack", {
  env,
  apiBaseUrl: requiredContext("monitoringApiBaseUrl"),
  webUrl: requiredContext("monitoringWebUrl"),
  webTitle: requiredContext("monitoringWebTitle"),
  apiCheckEveryMinutes: Number(app.node.tryGetContext("monitoringApiCheckEveryMinutes") ?? 5),
  webCheckEveryMinutes: Number(app.node.tryGetContext("monitoringWebCheckEveryMinutes") ?? 15),
});
