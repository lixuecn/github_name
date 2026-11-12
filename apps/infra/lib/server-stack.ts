import { CfnOutput, Duration, RemovalPolicy, SecretValue, Stack, type StackProps } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, Stats, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import {
	LambdaApplication,
	LambdaDeploymentConfig,
	LambdaDeploymentGroup,
} from "aws-cdk-lib/aws-codedeploy";
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Alias, Architecture, Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import type { ExistingNetwork } from "./go-api-service-stack";

const MEMORY_MB = 512;
const TIMEOUT = Duration.seconds(15);
const ALIAS_NAME = "live";

// Canary: 10% of invocations go to the new version for 5 minutes, then 100%.
// Either alarm firing during that window rolls the alias back.
const MAX_ERRORS_PER_MINUTE = 3;
const MAX_P95_DURATION_MS = 3000;

export interface ServerStackProps extends StackProps {
	readonly network: ExistingNetwork;
	readonly functionName: string;
	/** Built bundle directory (apps/server/dist/lambda, from `build:lambda`). */
	readonly codeDirectory: string;
	/** Existing API Gateway HTTP API that will invoke the `live` alias. */
	readonly httpApiId: string;
	/** Secrets Manager secret holding DATABASE_URL; used only when goApiUrl is unset. */
	readonly databaseUrlSecretName: string;
	readonly corsOrigin: string;
	/** Optional internal Go service URL; when set, github.list reads through it. */
	readonly goApiUrl?: string;
}

/**
 * The Hono/tRPC backend Lambda, managed by CDK, released with a CodeDeploy
 * canary through the `live` alias:
 *
 *   API Gateway ──▶ alias live ─┬─ new version 10% ┐ 5 min, then 100%;
 *                               └─ old version 90% ┘ alarms roll back
 */
export class ServerStack extends Stack {
	constructor(scope: Construct, id: string, props: ServerStackProps) {
		super(scope, id, props);
		const { network } = props;

		const vpc = Vpc.fromVpcAttributes(this, "Vpc", {
			availabilityZones: network.availabilityZones,
			privateSubnetIds: network.privateSubnetIds,
			privateSubnetRouteTableIds: network.privateSubnetRouteTableIds,
			vpcId: network.vpcId,
		});
		// Same security group as the console-managed function, so the existing
		// RDS (and go-api) ingress rules keep applying.
		const securityGroup = SecurityGroup.fromSecurityGroupId(
			this,
			"LambdaSg",
			network.lambdaSecurityGroupId,
			{ mutable: false }
		);

		const logGroup = new LogGroup(this, "Logs", {
			logGroupName: `/aws/lambda/${props.functionName}`,
			removalPolicy: RemovalPolicy.DESTROY,
			retention: RetentionDays.ONE_MONTH,
		});

		const environment: Record<string, string> = {
			CORS_ORIGIN: props.corsOrigin,
			NODE_ENV: "production",
			// Lambda's bundled CA file includes the Amazon RDS roots (sslmode=verify-full).
			NODE_EXTRA_CA_CERTS: "/var/runtime/ca-cert.pem",
		};
		if (props.goApiUrl) {
			// Every profile read/write goes through the Go service; the function
			// never connects to the database, so it gets no DATABASE_URL.
			environment.GO_API_URL = props.goApiUrl;
		} else {
			// Resolved by CloudFormation at deploy time; never stored in the repo.
			environment.DATABASE_URL = SecretValue.secretsManager(props.databaseUrlSecretName).unsafeUnwrap();
		}

		// The default role gets only CloudWatch Logs and VPC ENI permissions
		// (AWSLambdaBasicExecutionRole + AWSLambdaVPCAccessExecutionRole).
		const fn = new LambdaFunction(this, "Function", {
			architecture: Architecture.X86_64,
			code: Code.fromAsset(props.codeDirectory),
			// Keep every published version (CDK's default deletes the previous
			// one after a successful deploy), so `live` can be pointed back at
			// any earlier version and versions can be compared in the console.
			currentVersionOptions: { removalPolicy: RemovalPolicy.RETAIN },
			description: "github-name Hono/tRPC backend (CDK-managed)",
			environment,
			functionName: props.functionName,
			handler: "lambda.handler",
			logGroup,
			memorySize: MEMORY_MB,
			runtime: Runtime.NODEJS_22_X,
			securityGroups: [securityGroup],
			timeout: TIMEOUT,
			vpc,
			vpcSubnets: { subnets: vpc.privateSubnets },
		});

		// A new version is published whenever code or configuration changes.
		const alias = new Alias(this, "LiveAlias", {
			aliasName: ALIAS_NAME,
			version: fn.currentVersion,
		});
		alias.addPermission("HttpApiInvoke", {
			principal: new ServicePrincipal("apigateway.amazonaws.com"),
			sourceArn: this.formatArn({
				resource: props.httpApiId,
				resourceName: "*",
				service: "execute-api",
			}),
		});

		const errorsAlarm = new Alarm(this, "ErrorsAlarm", {
			alarmDescription: "Backend Lambda errors; CodeDeploy rolls back an in-progress canary",
			alarmName: `${props.functionName}-errors`,
			comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			evaluationPeriods: 1,
			metric: alias.metricErrors({ period: Duration.minutes(1), statistic: Stats.SUM }),
			threshold: MAX_ERRORS_PER_MINUTE,
			treatMissingData: TreatMissingData.NOT_BREACHING,
		});
		const durationAlarm = new Alarm(this, "DurationAlarm", {
			alarmDescription: `Backend Lambda p95 duration above ${MAX_P95_DURATION_MS}ms; CodeDeploy rolls back an in-progress canary`,
			alarmName: `${props.functionName}-p95-duration`,
			comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
			evaluationPeriods: 2,
			metric: alias.metricDuration({ period: Duration.minutes(1), statistic: Stats.p(95) }),
			threshold: MAX_P95_DURATION_MS,
			treatMissingData: TreatMissingData.NOT_BREACHING,
		});

		new LambdaDeploymentGroup(this, "Canary", {
			alarms: [errorsAlarm, durationAlarm],
			alias,
			application: new LambdaApplication(this, "Application", {
				applicationName: props.functionName,
			}),
			autoRollback: { deploymentInAlarm: true, failedDeployment: true, stoppedDeployment: true },
			deploymentConfig: LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
			deploymentGroupName: `${props.functionName}-canary`,
		});

		new CfnOutput(this, "FunctionName", { value: fn.functionName });
		new CfnOutput(this, "LiveAliasArn", {
			description: "Point the HTTP API integrations here to cut traffic over",
			value: alias.functionArn,
		});
	}
}
