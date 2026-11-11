import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { Peer, Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Repository } from "aws-cdk-lib/aws-ecr";
import {
  Cluster,
  ContainerImage,
  CpuArchitecture,
  FargateService,
  FargateTaskDefinition,
  LogDrivers,
  OperatingSystemFamily,
  Secret as EcsSecret,
} from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

const CONTAINER_PORT = 8080;
const ALB_PORT = 80;
const TASK_CPU = 256;
const TASK_MEMORY_MIB = 512;
// Below ECS's default 30s stopTimeout; the Go server drains for up to 20s.
const DEREGISTRATION_DELAY = Duration.seconds(15);

export interface ExistingNetwork {
  readonly vpcId: string;
  readonly availabilityZones: string[];
  /** Subnets with a NAT route; tasks and the internal ALB go here. */
  readonly privateSubnetIds: string[];
  /** Route table of each private subnet, same order (the NAT route table). */
  readonly privateSubnetRouteTableIds: string[];
  /** Lambda's security group: the only caller allowed to reach the ALB. */
  readonly lambdaSecurityGroupId: string;
  /** RDS security group; gets an ingress rule for the Go tasks. */
  readonly databaseSecurityGroupId: string;
  readonly databasePort: number;
}

export interface GoApiServiceStackProps extends StackProps {
  readonly network: ExistingNetwork;
  readonly repositoryName: string;
  /** Commit SHA tag in ECR. Unset → the service runs 0 tasks. */
  readonly imageTag?: string;
  readonly desiredCount: number;
  /** Secrets Manager secret whose value is the full DATABASE_URL. */
  readonly databaseUrlSecretName: string;
}

/**
 * go-api on ECS Fargate (arm64) in the existing VPC's private subnets, behind
 * an internal ALB that only the Lambda security group can reach:
 *
 *   Lambda SG ──80──▶ internal ALB ──8080──▶ Fargate tasks ──5432──▶ RDS
 */
export class GoApiServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: GoApiServiceStackProps) {
    super(scope, id, props);
    const { network } = props;

    const vpc = Vpc.fromVpcAttributes(this, "Vpc", {
      vpcId: network.vpcId,
      availabilityZones: network.availabilityZones,
      privateSubnetIds: network.privateSubnetIds,
      privateSubnetRouteTableIds: network.privateSubnetRouteTableIds,
    });
    const privateSubnets = { subnets: vpc.privateSubnets };

    const lambdaSg = SecurityGroup.fromSecurityGroupId(this, "LambdaSg", network.lambdaSecurityGroupId, {
      mutable: false,
    });
    const databaseSg = SecurityGroup.fromSecurityGroupId(this, "DatabaseSg", network.databaseSecurityGroupId, {
      mutable: true,
      allowAllOutbound: true,
    });

    const albSg = new SecurityGroup(this, "AlbSg", {
      vpc,
      description: "go-api internal ALB: HTTP from the Lambda only",
      allowAllOutbound: false,
    });
    albSg.addIngressRule(Peer.securityGroupId(lambdaSg.securityGroupId), Port.tcp(ALB_PORT), "Lambda");

    // Outbound: ECR / Secrets Manager / CloudWatch Logs via the NAT, and RDS.
    const taskSg = new SecurityGroup(this, "TaskSg", {
      vpc,
      description: "go-api Fargate tasks",
      allowAllOutbound: true,
    });
    // Lives in this stack; removing the stack removes only this rule.
    databaseSg.addIngressRule(taskSg, Port.tcp(network.databasePort), "go-api tasks");

    const cluster = new Cluster(this, "Cluster", { vpc, clusterName: "go-api" });

    const taskDefinition = new FargateTaskDefinition(this, "TaskDef", {
      family: "go-api",
      cpu: TASK_CPU,
      memoryLimitMiB: TASK_MEMORY_MIB,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    const repository = Repository.fromRepositoryName(this, "Repository", props.repositoryName);
    const databaseUrl = Secret.fromSecretNameV2(this, "DatabaseUrl", props.databaseUrlSecretName);
    const logGroup = new LogGroup(this, "Logs", {
      logGroupName: "/ecs/go-api",
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    taskDefinition.addContainer("app", {
      // "unset" never exists in ECR; it is only referenced while desiredCount is 0.
      image: ContainerImage.fromEcrRepository(repository, props.imageTag ?? "unset"),
      portMappings: [{ containerPort: CONTAINER_PORT }],
      environment: { PORT: String(CONTAINER_PORT) },
      secrets: { DATABASE_URL: EcsSecret.fromSecretsManager(databaseUrl) },
      logging: LogDrivers.awsLogs({ streamPrefix: "go-api", logGroup }),
      // The distroless image has no shell or curl; the binary probes itself.
      healthCheck: {
        command: ["CMD", "/server", "healthcheck"],
        interval: Duration.seconds(15),
        timeout: Duration.seconds(3),
        retries: 3,
        startPeriod: Duration.seconds(10),
      },
      readonlyRootFilesystem: true,
      stopTimeout: Duration.seconds(30),
    });

    const service = new FargateService(this, "Service", {
      serviceName: "go-api",
      cluster,
      taskDefinition,
      desiredCount: props.imageTag ? props.desiredCount : 0,
      vpcSubnets: privateSubnets,
      securityGroups: [taskSg],
      assignPublicIp: false,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      healthCheckGracePeriod: Duration.seconds(30),
    });

    const alb = new ApplicationLoadBalancer(this, "Alb", {
      loadBalancerName: "go-api-internal",
      vpc,
      internetFacing: false,
      vpcSubnets: privateSubnets,
      securityGroup: albSg,
    });
    const listener = alb.addListener("Http", {
      port: ALB_PORT,
      protocol: ApplicationProtocol.HTTP,
      open: false,
    });
    listener.addTargets("GoApi", {
      port: CONTAINER_PORT,
      protocol: ApplicationProtocol.HTTP,
      targets: [service],
      deregistrationDelay: DEREGISTRATION_DELAY,
      healthCheck: {
        path: "/health",
        interval: Duration.seconds(15),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    new CfnOutput(this, "GoApiUrl", {
      value: `http://${alb.loadBalancerDnsName}`,
      description: "Set as the Lambda environment variable GO_API_URL",
    });
    new CfnOutput(this, "ImageTag", { value: props.imageTag ?? "(unset: service runs 0 tasks)" });
  }
}
