# infra

AWS 基础设施（CDK，TypeScript），部署到账号 `314068109968` 的 `ap-southeast-2`（组织 SCP 只放行该区域）。

| 栈 | 资源 |
| --- | --- |
| `GoApiImageStack` | ECR 仓库 `go-api`（标签不可变、推送时扫描、未打标签镜像 1 天过期、最多保留 50 个）、GitHub 连接（CodeConnections）、CodeBuild 项目 `go-api-image` |
| `GoApiServiceStack` | ECS 集群与 Fargate 服务 `go-api`（arm64，0.25 vCPU / 0.5 GB）、内网 ALB `go-api-internal`、安全组、RDS 入站规则、日志组 `/ecs/go-api` |

## 服务拓扑（GoApiServiceStack）

```
Lambda (sg github-name-lambda-sg)
  ──HTTP 80──▶ 内网 ALB go-api-internal（私有子网 2a/2b，只放行 Lambda 安全组）
  ──8080────▶ Fargate 任务（私有子网，无公网 IP，经现有 NAT 访问 ECR / Secrets Manager / Logs）
  ──5432────▶ RDS github-name-dev-db（本栈在其安全组上追加一条入站规则）
```

- 复用现有默认 VPC `vpc-0de70fcd2f5218ab5` 及其 NAT 网关，网络参数写在 `cdk.json` 的 `context.network`
- `DATABASE_URL` 来自 Secrets Manager 密钥 `go-api/database-url`（部署前须已存在，栈只引用不创建）
- 健康检查：ALB 探测 `/health`；容器内 `/server healthcheck`；部署失败自动回滚（circuit breaker）
- 根文件系统只读；滚动发布时保持 100% 健康副本，旧任务从 ALB 摘除后 15 秒停止

### 部署

```sh
# 指定要运行的镜像（ECR 中的 commit SHA 标签）
pnpm --filter infra deploy:service -- -c goApiImageTag=<commit sha>
```

不带 `goApiImageTag` 部署时服务副本数为 0（只建资源、不跑任务）。副本数由 `cdk.json` 的 `goApiDesiredCount` 控制（默认 1；高可用改为 2）。部署输出 `GoApiUrl`，设为 Lambda 环境变量 `GO_API_URL` 后列表读取即切到 Go 服务（见 `apps/server/LAMBDA.md`）。

### 费用（悉尼，大致）

| 项 | 月费 |
| --- | --- |
| 内网 ALB | 约 $18–20（创建即计费） |
| Fargate arm64 0.25 vCPU / 0.5 GB | 约 $9 / 每个任务 |
| Secrets Manager 密钥 | $0.40 |
| NAT 网关 | 已存在，新增的只有少量流量费 |

## 镜像流水线

```
push 到 main（改动涉及 apps/go-api/**）
  → CodeBuild 通过 GitHub 连接拉代码（arm64 原生构建）
  → go vet + go test
  → docker build → 推送 ECR，标签 = commit SHA（已存在则跳过）
```

- PR 与 main 的测试由 GitHub Actions 跑（`.github/workflows/go-api-ci.yml`，含 Postgres 集成测试），不需要任何 AWS 凭证
- 为什么不用 GitHub Actions 直接推 ECR：组织 SCP 禁止创建 IAM OIDC 提供方，而我们不想把长期 AWS 密钥存进 GitHub。CodeBuild 在 AWS 内部运行，用自己的 IAM 角色推镜像，GitHub 里不保存任何 AWS 凭证
- 基础镜像来自 ECR Public 与 GCR，避开 Docker Hub 对 CodeBuild 共享 IP 的匿名拉取限流

## 首次部署（两阶段）

前提：`aws sts get-caller-identity` 能返回账号 `314068109968`，区域 `ap-southeast-2`。

```sh
# 1. 每个账号 + 区域只需一次
pnpm --filter infra exec cdk bootstrap

# 2. 第一阶段：ECR 仓库 + GitHub 连接（连接创建后处于 PENDING）
pnpm --filter infra deploy:image
```

3. **在控制台授权 GitHub 连接（只需一次）**：开发人员工具 → 设置 → 连接 → 选中 `go-api-github` → 更新待处理的连接 → 安装或选择 GitHub App，并授权仓库 `lixuecn/github_name`。状态变为"可用"即完成。

```sh
# 4. 第二阶段：加上 CodeBuild 项目和 webhook
pnpm --filter infra deploy:image -- -c githubConnectionReady=true
```

完成后把 `cdk.json` 里的 `githubConnectionReady` 改为 `true`，否则以后不带参数部署会删掉 CodeBuild 项目。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `aws codebuild start-build --project-name go-api-image` | 手动为 main 最新提交构建镜像 |
| `aws ecr describe-images --repository-name go-api` | 查看已推送的镜像 |
| `pnpm --filter infra check-types` | 类型检查 |
| `pnpm --filter infra synth` | 生成 CloudFormation 模板到 `cdk.out/`，不需要凭证 |
| `pnpm --filter infra diff` | 与线上对比 |

可调参数在 `cdk.json` 的 `context` 中：`githubRepository`、`githubBranch`、`goApiRepositoryName`、`githubConnectionReady`。ECR 仓库设为保留：删除栈时不会删除仓库及其中的镜像。

## 费用（大致）

- ECR：存储约 $0.10/GB·月，每个镜像约 10 MB
- CodeBuild `arm1.small`：按构建分钟计费，每次构建约 2–4 分钟
- CodeConnections：免费
