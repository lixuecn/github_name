import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { ServerStack } from "../lib/server-stack";

const bundleDir = mkdtempSync(join(tmpdir(), "server-bundle-"));
writeFileSync(join(bundleDir, "lambda.mjs"), "export const handler = async () => ({});\n");
after(() => rmSync(bundleDir, { force: true, recursive: true }));

function serverTemplate(goApiUrl?: string, extraRollbackAlarmNames?: string[]): Template {
	const stack = new ServerStack(new App(), "TestServer", {
		codeDirectory: bundleDir,
		corsOrigin: "https://example.workers.dev",
		databaseUrlSecretName: "server/database-url",
		env: { account: "123456789012", region: "ap-southeast-2" },
		extraRollbackAlarmNames,
		functionName: "github-name-backend",
		goApiUrl,
		httpApiId: "abc123",
		network: {
			availabilityZones: ["ap-southeast-2a", "ap-southeast-2b"],
			databasePort: 5432,
			databaseSecurityGroupId: "sg-22222222",
			lambdaSecurityGroupId: "sg-11111111",
			privateSubnetIds: ["subnet-11111111", "subnet-22222222"],
			privateSubnetRouteTableIds: ["rtb-11111111", "rtb-22222222"],
			vpcId: "vpc-12345678",
		},
	});
	return Template.fromStack(stack);
}

test("runs in the existing VPC with the Lambda security group and a least-privilege role", () => {
	const template = serverTemplate();
	template.hasResourceProperties("AWS::Lambda::Function", {
		FunctionName: "github-name-backend",
		Handler: "lambda.handler",
		MemorySize: 512,
		Runtime: "nodejs22.x",
		Timeout: 15,
		VpcConfig: {
			SecurityGroupIds: ["sg-11111111"],
			SubnetIds: ["subnet-11111111", "subnet-22222222"],
		},
	});
	template.hasResourceProperties("AWS::IAM::Role", {
		ManagedPolicyArns: [
			Match.objectLike({ "Fn::Join": Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp("AWSLambdaBasicExecutionRole")])]) }),
			Match.objectLike({ "Fn::Join": Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp("AWSLambdaVPCAccessExecutionRole")])]) }),
		],
	});
	// No inline policy grants anything beyond those managed policies.
	template.resourceCountIs("AWS::IAM::Policy", 0);
});

test("without the Go service it reads DATABASE_URL from Secrets Manager; with it, no database access", () => {
	const env = (template: Template) => {
		const [fn] = Object.values(template.findResources("AWS::Lambda::Function"));
		return fn?.Properties.Environment.Variables as Record<string, unknown>;
	};
	const withoutGo = env(serverTemplate());
	assert.match(JSON.stringify(withoutGo.DATABASE_URL), /resolve:secretsmanager:.*server\/database-url/);
	assert.equal(withoutGo.CORS_ORIGIN, "https://example.workers.dev");
	assert.equal(withoutGo.NODE_ENV, "production");
	assert.equal("GO_API_URL" in withoutGo, false);
	assert.equal("BETTER_AUTH_SECRET" in withoutGo, false);

	const withGo = env(serverTemplate("http://go-api.github-name.internal:8080"));
	assert.equal(withGo.GO_API_URL, "http://go-api.github-name.internal:8080");
	assert.equal("DATABASE_URL" in withGo, false);
});

test("releases through a live alias with a CodeDeploy 10%/5min canary and alarm rollback", () => {
	const template = serverTemplate();
	template.hasResourceProperties("AWS::Lambda::Alias", { Name: "live" });
	// Published versions are retained so earlier ones stay available for rollback.
	template.hasResource("AWS::Lambda::Version", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });
	template.hasResourceProperties("AWS::CodeDeploy::DeploymentGroup", {
		AlarmConfiguration: {
			Alarms: [
				{ Name: { Ref: Match.stringLikeRegexp("ErrorsAlarm") } },
				{ Name: { Ref: Match.stringLikeRegexp("DurationAlarm") } },
			],
			Enabled: true,
		},
		AutoRollbackConfiguration: {
			Enabled: true,
			Events: Match.arrayWith(["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"]),
		},
		DeploymentConfigName: "CodeDeployDefault.LambdaCanary10Percent5Minutes",
		DeploymentStyle: { DeploymentOption: "WITH_TRAFFIC_CONTROL", DeploymentType: "BLUE_GREEN" },
	});
	template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
	template.hasResourceProperties("AWS::Lambda::Alias", {
		RoutingConfig: Match.absent(),
	});
});

test("lets only the existing HTTP API invoke the alias", () => {
	const template = serverTemplate();
	template.hasResourceProperties("AWS::Lambda::Permission", {
		Action: "lambda:InvokeFunction",
		FunctionName: Match.objectLike({ Ref: Match.stringLikeRegexp("LiveAlias") }),
		Principal: "apigateway.amazonaws.com",
		SourceArn: {
			"Fn::Join": ["", Match.arrayWith([Match.stringLikeRegexp(":execute-api:ap-southeast-2:123456789012:abc123/\\*$")])],
		},
	});
});

test("adds extra alarms (e.g. the Synthetics API check) to the canary rollback", () => {
	const template = serverTemplate(undefined, ["github-name-api-check"]);
	template.hasResourceProperties("AWS::CodeDeploy::DeploymentGroup", {
		AlarmConfiguration: {
			Alarms: Match.arrayWith([{ Name: "github-name-api-check" }]),
			Enabled: true,
		},
	});
});
