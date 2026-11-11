import {
	CfnOutput,
	Duration,
	RemovalPolicy,
	Stack,
	type StackProps,
} from "aws-cdk-lib";
import { Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Repository } from "aws-cdk-lib/aws-ecr";
import {
	Cluster,
	ContainerImage,
	CpuArchitecture,
	DeploymentStrategy,
	Secret as EcsSecret,
	FargateService,
	FargateTaskDefinition,
	LogDrivers,
	OperatingSystemFamily,
} from "aws-cdk-lib/aws-ecs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import {
	DnsRecordType,
	PrivateDnsNamespace,
} from "aws-cdk-lib/aws-servicediscovery";
import type { Construct } from "constructs";

const CONTAINER_NAME = "app";
const CONTAINER_PORT = 8080;
const TASK_CPU = 256;
const TASK_MEMORY_MIB = 512;
const DISCOVERY_NAMESPACE = "github-name.internal";
const DISCOVERY_SERVICE = "go-api";
const DISCOVERY_DNS_TTL = Duration.seconds(10);

export interface ExistingNetwork {
	readonly availabilityZones: string[];
	readonly databasePort: number;
	/** RDS security group; gets an ingress rule for the Go tasks. */
	readonly databaseSecurityGroupId: string;
	/** Lambda's security group: the only caller allowed to reach the Go tasks. */
	readonly lambdaSecurityGroupId: string;
	/** Subnets with a NAT route; tasks go here. */
	readonly privateSubnetIds: string[];
	/** Route table of each private subnet, same order (the NAT route table). */
	readonly privateSubnetRouteTableIds: string[];
	readonly vpcId: string;
}

export interface GoApiServiceStackProps extends StackProps {
	/** Secrets Manager secret whose value is the full DATABASE_URL. */
	readonly databaseUrlSecretName: string;
	readonly desiredCount: number;
	/** Commit SHA tag in ECR. Unset → the service runs 0 tasks. */
	readonly imageTag?: string;
	readonly network: ExistingNetwork;
	readonly repositoryName: string;
}

/**
 * go-api on ECS Fargate (arm64), discovered through private Cloud Map DNS:
 *
 *   Lambda SG ──8080──▶ Fargate tasks ──5432──▶ RDS
 */
export class GoApiServiceStack extends Stack {
	constructor(scope: Construct, id: string, props: GoApiServiceStackProps) {
		super(scope, id, props);
		const { network } = props;

		const vpc = Vpc.fromVpcAttributes(this, "Vpc", {
			availabilityZones: network.availabilityZones,
			privateSubnetIds: network.privateSubnetIds,
			privateSubnetRouteTableIds: network.privateSubnetRouteTableIds,
			vpcId: network.vpcId,
		});
		const privateSubnets = { subnets: vpc.privateSubnets };

		const lambdaSg = SecurityGroup.fromSecurityGroupId(
			this,
			"LambdaSg",
			network.lambdaSecurityGroupId,
			{
				mutable: false,
			}
		);
		const databaseSg = SecurityGroup.fromSecurityGroupId(
			this,
			"DatabaseSg",
			network.databaseSecurityGroupId,
			{
				allowAllOutbound: true,
				mutable: true,
			}
		);

		// Outbound: ECR / Secrets Manager / CloudWatch Logs via the NAT, and RDS.
		const taskSg = new SecurityGroup(this, "TaskSg", {
			allowAllOutbound: true,
			description: "go-api Fargate tasks",
			vpc,
		});
		// Lives in this stack; removing the stack removes only this rule.
		databaseSg.addIngressRule(
			taskSg,
			Port.tcp(network.databasePort),
			"go-api tasks"
		);

		const cluster = new Cluster(this, "Cluster", {
			clusterName: "go-api",
			vpc,
		});
		const namespace = new PrivateDnsNamespace(this, "Namespace", {
			description: "Private service discovery for github-name",
			name: DISCOVERY_NAMESPACE,
			vpc,
		});

		const taskDefinition = new FargateTaskDefinition(this, "TaskDef", {
			cpu: TASK_CPU,
			family: "go-api",
			memoryLimitMiB: TASK_MEMORY_MIB,
			runtimePlatform: {
				cpuArchitecture: CpuArchitecture.ARM64,
				operatingSystemFamily: OperatingSystemFamily.LINUX,
			},
		});

		const repository = Repository.fromRepositoryName(
			this,
			"Repository",
			props.repositoryName
		);
		const databaseUrl = Secret.fromSecretNameV2(
			this,
			"DatabaseUrl",
			props.databaseUrlSecretName
		);
		const logGroup = new LogGroup(this, "Logs", {
			logGroupName: "/ecs/go-api",
			removalPolicy: RemovalPolicy.DESTROY,
			retention: RetentionDays.ONE_MONTH,
		});

		taskDefinition.addContainer(CONTAINER_NAME, {
			environment: { PORT: String(CONTAINER_PORT) },
			// The distroless image has no shell or curl; the binary probes itself.
			healthCheck: {
				command: ["CMD", "/server", "healthcheck"],
				interval: Duration.seconds(15),
				retries: 3,
				startPeriod: Duration.seconds(10),
				timeout: Duration.seconds(3),
			},
			// "unset" never exists in ECR; it is only referenced while desiredCount is 0.
			image: ContainerImage.fromEcrRepository(
				repository,
				props.imageTag ?? "unset"
			),
			logging: LogDrivers.awsLogs({ logGroup, streamPrefix: "go-api" }),
			portMappings: [{ containerPort: CONTAINER_PORT }],
			readonlyRootFilesystem: true,
			secrets: { DATABASE_URL: EcsSecret.fromSecretsManager(databaseUrl) },
			stopTimeout: Duration.seconds(30),
		});

		const service = new FargateService(this, "Service", {
			assignPublicIp: false,
			circuitBreaker: { enable: true, rollback: true },
			cloudMapOptions: {
				cloudMapNamespace: namespace,
				dnsRecordType: DnsRecordType.A,
				dnsTtl: DISCOVERY_DNS_TTL,
				name: DISCOVERY_SERVICE,
			},
			cluster,
			deploymentStrategy: DeploymentStrategy.ROLLING,
			desiredCount: props.imageTag ? props.desiredCount : 0,
			maxHealthyPercent: 200,
			// Never drop below the desired count: the new revision starts alongside.
			minHealthyPercent: 100,
			securityGroups: [taskSg],
			serviceName: "go-api",
			taskDefinition,
			vpcSubnets: privateSubnets,
		});
		service.connections.allowFrom(
			lambdaSg,
			Port.tcp(CONTAINER_PORT),
			"Lambda to Go tasks"
		);

		// biome-ignore lint/correctness/noUnusedInstantiation: CDK outputs register themselves on the stack.
		new CfnOutput(this, "GoApiUrl", {
			description: "Set as the Lambda environment variable GO_API_URL",
			value: `http://${DISCOVERY_SERVICE}.${namespace.namespaceName}:${CONTAINER_PORT}`,
		});
		// biome-ignore lint/correctness/noUnusedInstantiation: CDK outputs register themselves on the stack.
		new CfnOutput(this, "ImageTag", {
			value: props.imageTag ?? "(unset: service runs 0 tasks)",
		});
	}
}
