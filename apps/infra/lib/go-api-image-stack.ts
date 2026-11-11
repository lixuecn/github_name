import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  BuildSpec,
  type CfnProject,
  ComputeType,
  EventAction,
  FilterGroup,
  LinuxArmBuildImage,
  LocalCacheMode,
  Cache,
  Project,
  Source,
} from "aws-cdk-lib/aws-codebuild";
import { CfnConnection } from "aws-cdk-lib/aws-codeconnections";
import { Repository, TagMutability, TagStatus } from "aws-cdk-lib/aws-ecr";
import { PolicyDocument, PolicyStatement, Role, ServicePrincipal, User } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

const UNTAGGED_IMAGE_EXPIRY_DAYS = 1;
const MAX_TAGGED_IMAGES = 50;
const BUILD_TIMEOUT_MINUTES = 20;
const GO_API_DIR = "apps/go-api";
const GO_IMAGE = "public.ecr.aws/docker/library/golang:1.27.3-alpine";

export interface GoApiImageStackProps extends StackProps {
  /** "owner/repo" on GitHub. */
  readonly githubRepository: string;
  /** Pushes to this branch build and push an image. */
  readonly githubBranch: string;
  readonly repositoryName: string;
  /**
   * The GitHub connection is created in PENDING state and must be authorized
   * once in the console. CodeBuild cannot register its webhook until then, so
   * the build project is only added once this is true (second deploy).
   */
  readonly githubConnectionReady: boolean;
  /**
   * Interim path while CodeBuild has no concurrency quota: an IAM user that
   * can only push/pull this repository, whose access key (created by a human
   * in the console) GitHub Actions uses. Set false to delete the user.
   */
  readonly githubActionsPushUser: boolean;
}

/**
 * ECR repository for the go-api image and a CodeBuild project that builds and
 * pushes it on every push to the main branch that touches apps/go-api.
 *
 * Builds run inside AWS and pull source through an AWS CodeConnections GitHub
 * connection, so no AWS credentials are stored in GitHub. (GitHub OIDC is not
 * an option: the AWS Organization's SCP denies IAM OIDC provider actions.)
 */
export class GoApiImageStack extends Stack {
  readonly repository: Repository;

  constructor(scope: Construct, id: string, props: GoApiImageStackProps) {
    super(scope, id, props);

    this.repository = new Repository(this, "Repository", {
      repositoryName: props.repositoryName,
      // Images are tagged with the git commit SHA; a tag never moves, so a
      // deployment always runs exactly the commit it names.
      imageTagMutability: TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          rulePriority: 1,
          description: "Expire untagged images (failed or superseded pushes)",
          tagStatus: TagStatus.UNTAGGED,
          maxImageAge: Duration.days(UNTAGGED_IMAGE_EXPIRY_DAYS),
        },
        {
          rulePriority: 2,
          description: `Keep the ${MAX_TAGGED_IMAGES} most recent images`,
          tagStatus: TagStatus.ANY,
          maxImageCount: MAX_TAGGED_IMAGES,
        },
      ],
    });

    const connection = new CfnConnection(this, "GithubConnection", {
      connectionName: `${props.repositoryName}-github`,
      providerType: "GitHub",
    });

    new CfnOutput(this, "RepositoryUri", { value: this.repository.repositoryUri });
    new CfnOutput(this, "GithubConnectionArn", {
      value: connection.attrConnectionArn,
      description: "Authorize once: console > Developer Tools > Settings > Connections > Update pending connection",
    });

    if (props.githubConnectionReady) {
      this.addBuildProject(props, connection);
    }
    if (props.githubActionsPushUser) {
      this.addGithubActionsPushUser(props.repositoryName);
    }
  }

  private addGithubActionsPushUser(repositoryName: string): void {
    const user = new User(this, "GithubActionsPushUser", {
      userName: `${repositoryName}-github-ecr-push`,
    });
    // ecr:GetAuthorizationToken (account-wide by design) + push/pull and
    // DescribeImages on this one repository; nothing else in the account.
    this.repository.grantPullPush(user);
    this.repository.grant(user, "ecr:DescribeImages");
    new CfnOutput(this, "GithubActionsPushUserName", {
      value: user.userName,
      description: "Create an access key for this user in the IAM console; store it as GitHub secrets",
    });
  }

  private addBuildProject(props: GoApiImageStackProps, connection: CfnConnection): void {
    const [owner, repo] = props.githubRepository.split("/");
    if (!(owner && repo)) {
      throw new Error(`githubRepository must be "owner/repo", got "${props.githubRepository}"`);
    }

    // CodeBuild checks at project creation that its service role may use the
    // connection, so that permission must exist on the role itself (inline),
    // not in a separate policy resource CloudFormation may create afterwards.
    const role = new Role(this, "ImageBuildRole", {
      assumedBy: new ServicePrincipal("codebuild.amazonaws.com"),
      inlinePolicies: {
        GithubConnection: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: [
                "codeconnections:GetConnection",
                "codeconnections:GetConnectionToken",
                "codeconnections:UseConnection",
                "codestar-connections:GetConnection",
                "codestar-connections:GetConnectionToken",
                "codestar-connections:UseConnection",
              ],
              resources: [connection.attrConnectionArn],
            }),
          ],
        }),
      },
    });

    const project = new Project(this, "ImageBuild", {
      projectName: `${props.repositoryName}-image`,
      role,
      description: `Build ${props.repositoryName} (linux/arm64) on push to ${props.githubBranch} and push to ECR`,
      source: Source.gitHub({
        owner,
        repo,
        branchOrRef: props.githubBranch,
        reportBuildStatus: true,
        webhook: true,
        webhookFilters: [
          FilterGroup.inEventOf(EventAction.PUSH)
            .andBranchIs(props.githubBranch)
            .andFilePathIs(`^${GO_API_DIR}/.*`),
        ],
      }),
      environment: {
        // Native arm64 build for Graviton Fargate tasks; privileged for Docker.
        buildImage: LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        computeType: ComputeType.SMALL,
        privileged: true,
        environmentVariables: {
          REPOSITORY_URI: { value: this.repository.repositoryUri },
          REPOSITORY_NAME: { value: this.repository.repositoryName },
          GO_IMAGE: { value: GO_IMAGE },
          GO_API_DIR: { value: GO_API_DIR },
        },
      },
      cache: Cache.local(LocalCacheMode.DOCKER_LAYER),
      timeout: Duration.minutes(BUILD_TIMEOUT_MINUTES),
      // Keep build logs for a month rather than forever.
      logging: {
        cloudWatch: {
          logGroup: new LogGroup(this, "ImageBuildLogs", {
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
          }),
        },
      },
      buildSpec: BuildSpec.fromObject({
        version: "0.2",
        env: { shell: "bash", variables: { DOCKER_BUILDKIT: "1" } },
        phases: {
          pre_build: {
            commands: [
              'IMAGE_TAG="$CODEBUILD_RESOLVED_SOURCE_VERSION"',
              'echo "Commit $IMAGE_TAG"',
              'aws ecr get-login-password | docker login --username AWS --password-stdin "${REPOSITORY_URI%%/*}"',
              // Tags are immutable: a rebuild of the same commit must not push again.
              'if aws ecr describe-images --repository-name "$REPOSITORY_NAME" --image-ids "imageTag=$IMAGE_TAG" >/dev/null 2>&1; then IMAGE_EXISTS=true; echo "Image already exists, skipping"; else IMAGE_EXISTS=false; fi',
            ],
          },
          build: {
            commands: [
              // Same gate as GitHub Actions CI, so a broken main never ships an image.
              'if [ "$IMAGE_EXISTS" = "false" ]; then docker run --rm -v "$PWD/$GO_API_DIR:/src" -w /src "$GO_IMAGE" sh -c "go vet ./... && go test ./..."; fi',
              'if [ "$IMAGE_EXISTS" = "false" ]; then docker build -t "$REPOSITORY_URI:$IMAGE_TAG" "$GO_API_DIR"; fi',
            ],
          },
          post_build: {
            commands: [
              'if [ "$CODEBUILD_BUILD_SUCCEEDING" = "1" ] && [ "$IMAGE_EXISTS" = "false" ]; then docker push "$REPOSITORY_URI:$IMAGE_TAG" && echo "Pushed $REPOSITORY_URI:$IMAGE_TAG"; fi',
            ],
          },
        },
      }),
    });

    // Source.gitHub defaults to account-level OAuth credentials; use the
    // CodeConnections connection instead.
    const cfnProject = project.node.defaultChild as CfnProject;
    cfnProject.addPropertyOverride("Source.Auth", {
      Type: "CODECONNECTIONS",
      Resource: connection.attrConnectionArn,
    });
    this.repository.grantPullPush(project);
    this.repository.grant(project, "ecr:DescribeImages");

    new CfnOutput(this, "BuildProjectName", { value: project.projectName });
  }
}
