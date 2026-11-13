import { test } from "node:test";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { API_CHECK_ALARM_NAME, MonitoringStack, WEB_CHECK_ALARM_NAME } from "../lib/monitoring-stack";

function monitoringTemplate(): Template {
	const stack = new MonitoringStack(new App(), "TestMonitoring", {
		apiBaseUrl: "https://abc123.execute-api.ap-southeast-2.amazonaws.com",
		apiCheckEveryMinutes: 10,
		env: { account: "123456789012", region: "ap-southeast-2" },
		webCheckEveryMinutes: 15,
		webTitle: "GitHub 人员",
		webUrl: "https://example.workers.dev/github",
	});
	return Template.fromStack(stack);
}

test("runs two small check functions within the account's 512 MB Lambda limit", () => {
	const template = monitoringTemplate();
	template.hasResourceProperties("AWS::Lambda::Function", {
		FunctionName: API_CHECK_ALARM_NAME,
		MemorySize: 256,
		Runtime: "nodejs22.x",
		Environment: {
			Variables: { CHECK: "api", API_BASE_URL: "https://abc123.execute-api.ap-southeast-2.amazonaws.com" },
		},
	});
	template.hasResourceProperties("AWS::Lambda::Function", {
		FunctionName: WEB_CHECK_ALARM_NAME,
		MemorySize: 256,
		Environment: {
			Variables: Match.objectLike({ CHECK: "web", WEB_URL: "https://example.workers.dev/github", WEB_TITLE: "GitHub 人员" }),
		},
	});
	// No VPC: the checks go through the public internet like a user would.
	for (const fn of Object.values(template.findResources("AWS::Lambda::Function"))) {
		if (fn.Properties?.VpcConfig) {
			throw new Error("health check functions must not run inside the VPC");
		}
	}
});

test("schedules the API check every 10 minutes and the web check every 15, without retries", () => {
	const template = monitoringTemplate();
	template.hasResourceProperties("AWS::Events::Rule", {
		ScheduleExpression: "rate(10 minutes)",
		Targets: [Match.objectLike({ RetryPolicy: { MaximumRetryAttempts: 0 } })],
	});
	template.hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "rate(15 minutes)" });
	template.resourceCountIs("AWS::Lambda::EventInvokeConfig", 2);
	template.hasResourceProperties("AWS::Lambda::EventInvokeConfig", { MaximumRetryAttempts: 0 });
});

test("alarms when a scheduled run fails", () => {
	const template = monitoringTemplate();
	for (const [name, period] of [
		[API_CHECK_ALARM_NAME, 600],
		[WEB_CHECK_ALARM_NAME, 900],
	] as const) {
		template.hasResourceProperties("AWS::CloudWatch::Alarm", {
			AlarmName: name,
			MetricName: "Errors",
			Namespace: "AWS/Lambda",
			Period: period,
			Statistic: "Sum",
			Threshold: 1,
			ComparisonOperator: "GreaterThanOrEqualToThreshold",
			TreatMissingData: "notBreaching",
		});
	}
});
