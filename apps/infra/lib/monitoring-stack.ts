import { fileURLToPath } from "node:url";

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, Stats, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaTarget } from "aws-cdk-lib/aws-events-targets";
import { Architecture, Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

const HEALTH_CHECK_CODE = fileURLToPath(new URL("../health-checks", import.meta.url));
const MEMORY_MB = 256;
const TIMEOUT = Duration.seconds(30);

export const API_CHECK_ALARM_NAME = "github-name-api-check";
export const WEB_CHECK_ALARM_NAME = "github-name-web-check";

export interface MonitoringStackProps extends StackProps {
  /** Public API base, e.g. https://xxxx.execute-api.ap-southeast-2.amazonaws.com */
  readonly apiBaseUrl: string;
  /** Web page to check, e.g. https://github-name.example.workers.dev/github */
  readonly webUrl: string;
  /** The page's expected <title>. */
  readonly webTitle: string;
  readonly apiCheckEveryMinutes: number;
  readonly webCheckEveryMinutes: number;
}

/**
 * Scheduled health checks ("巡检") for production. CloudWatch Synthetics needs
 * ~1 GB Lambda memory and this account caps Lambda at 512 MB, so each check is
 * a small Lambda (health-checks/index.mjs) on an EventBridge schedule:
 *
 * - github-name-api-check: API Gateway → Lambda → go-api → RDS
 * - github-name-web-check: the page renders (title) and allows CORS to the API
 *
 * A failed run is a Lambda error; each function has an Errors alarm. The API
 * alarm is also a rollback alarm of the backend Lambda's CodeDeploy canary.
 */
export class MonitoringStack extends Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const healthCheck = (
      id: string,
      functionName: string,
      everyMinutes: number,
      environment: Record<string, string>
    ) => {
      const fn = new LambdaFunction(this, id, {
        functionName,
        description: `Scheduled health check (${environment.CHECK}) every ${everyMinutes} min`,
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        handler: "index.handler",
        code: Code.fromAsset(HEALTH_CHECK_CODE),
        memorySize: MEMORY_MB,
        timeout: TIMEOUT,
        environment,
        // A failed check must count once, not be retried into three errors.
        retryAttempts: 0,
        logGroup: new LogGroup(this, `${id}Logs`, {
          logGroupName: `/aws/lambda/${functionName}`,
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      });
      new Rule(this, `${id}Schedule`, {
        description: `Run ${functionName} every ${everyMinutes} minutes`,
        schedule: Schedule.rate(Duration.minutes(everyMinutes)),
        targets: [new LambdaTarget(fn, { retryAttempts: 0 })],
      });
      // Any failed run within the schedule period trips the alarm; missing
      // data (no run yet) does not.
      new Alarm(this, `${id}Alarm`, {
        alarmName: functionName,
        alarmDescription: `Health check ${functionName} failed (see /aws/lambda/${functionName})`,
        metric: fn.metricErrors({ period: Duration.minutes(everyMinutes), statistic: Stats.SUM }),
        threshold: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
      return fn;
    };

    const apiCheck = healthCheck("ApiCheck", API_CHECK_ALARM_NAME, props.apiCheckEveryMinutes, {
      CHECK: "api",
      API_BASE_URL: props.apiBaseUrl,
    });
    const webCheck = healthCheck("WebCheck", WEB_CHECK_ALARM_NAME, props.webCheckEveryMinutes, {
      CHECK: "web",
      API_BASE_URL: props.apiBaseUrl,
      WEB_URL: props.webUrl,
      WEB_TITLE: props.webTitle,
    });

    new CfnOutput(this, "ApiCheckFunction", { value: apiCheck.functionName });
    new CfnOutput(this, "WebCheckFunction", { value: webCheck.functionName });
  }
}
