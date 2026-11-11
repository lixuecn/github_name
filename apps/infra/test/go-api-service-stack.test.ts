import { test } from "node:test";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { GoApiServiceStack } from "../lib/go-api-service-stack";

function serviceTemplate(imageTag?: string): Template {
	const stack = new GoApiServiceStack(new App(), "TestService", {
		databaseUrlSecretName: "go-api/database-url",
		desiredCount: 2,
		env: { account: "123456789012", region: "ap-southeast-2" },
		imageTag,
		network: {
			availabilityZones: ["ap-southeast-2a", "ap-southeast-2b"],
			databasePort: 5432,
			databaseSecurityGroupId: "sg-22222222",
			lambdaSecurityGroupId: "sg-11111111",
			privateSubnetIds: ["subnet-11111111", "subnet-22222222"],
			privateSubnetRouteTableIds: ["rtb-11111111", "rtb-22222222"],
			vpcId: "vpc-12345678",
		},
		repositoryName: "go-api",
	});
	return Template.fromStack(stack);
}

test("registers private task IPs in Cloud Map and outputs the direct HTTP endpoint", () => {
	const template = serviceTemplate("commit-sha");
	template.hasResourceProperties("AWS::ServiceDiscovery::PrivateDnsNamespace", {
		Name: "github-name.internal",
		Vpc: "vpc-12345678",
	});
	template.resourceCountIs("AWS::ServiceDiscovery::Service", 1);
	template.hasResourceProperties("AWS::ServiceDiscovery::Service", {
		DnsConfig: { DnsRecords: [{ TTL: 10, Type: "A" }] },
		HealthCheckCustomConfig: { FailureThreshold: 1 },
		Name: "go-api",
	});
	template.hasResourceProperties("AWS::ECS::Service", {
		DeploymentConfiguration: {
			Alarms: { AlarmNames: [], Enable: false, Rollback: false },
			CanaryConfiguration: Match.absent(),
			DeploymentCircuitBreaker: { Enable: true, Rollback: true },
			MaximumPercent: 200,
			MinimumHealthyPercent: 100,
			Strategy: "ROLLING",
		},
		DesiredCount: 2,
		LoadBalancers: Match.absent(),
		NetworkConfiguration: {
			AwsvpcConfiguration: { AssignPublicIp: "DISABLED" },
		},
		ServiceRegistries: [{ RegistryArn: Match.anyValue() }],
	});
	template.hasOutput("GoApiUrl", {
		Value: "http://go-api.github-name.internal:8080",
	});
	template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
	template.resourceCountIs("AWS::ElasticLoadBalancingV2::TargetGroup", 0);
	template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
});

test("only permits Lambda ingress to tasks and preserves database access and health checks", () => {
	const template = serviceTemplate("commit-sha");
	template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
	template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 2);
	template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
		Description: "Lambda to Go tasks",
		FromPort: 8080,
		GroupId: Match.anyValue(),
		IpProtocol: "tcp",
		SourceSecurityGroupId: "sg-11111111",
		ToPort: 8080,
	});
	template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
		FromPort: 5432,
		GroupId: "sg-22222222",
		SourceSecurityGroupId: Match.anyValue(),
		ToPort: 5432,
	});
	template.hasResourceProperties("AWS::ECS::TaskDefinition", {
		ContainerDefinitions: Match.arrayWith([
			Match.objectLike({
				HealthCheck: { Command: ["CMD", "/server", "healthcheck"] },
				ReadonlyRootFilesystem: true,
				Secrets: [{ Name: "DATABASE_URL", ValueFrom: Match.anyValue() }],
			}),
		]),
	});
});

test("keeps the service stopped when no image tag is supplied", () => {
	serviceTemplate().hasResourceProperties("AWS::ECS::Service", {
		DesiredCount: 0,
	});
});
