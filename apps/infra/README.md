# infra

开发、构建、发布与服务调用流程见 [当前开发流程图](DEVELOPMENT.md)。

AWS 基础设施（CDK，TypeScript），部署到账号 `314068109968` 的 `ap-southeast-2`（组织 SCP 只放行该区域）。

| 栈 | 资源 |
| --- | --- |
| `GoApiImageStack` | ECR 仓库 `go-api`（标签不可变、推送时扫描、未打标签镜像 1 天过期、最多保留 50 个）、GitHub 连接（CodeConnections）、CodeBuild 项目 `go-api-image`；过渡期另有 IAM 用户 `go-api-github-ecr-push`（仅能推/拉 `go-api`，供 GitHub Actions 推镜像，CodeBuild 配额到位后将 `cdk.json` 的 `githubActionsPushUser` 设为 `false` 并删除 GitHub 密钥） |
| `GoApiServiceStack` | ECS 集群与 Fargate 服务 `go-api`（arm64，0.25 vCPU / 0.5 GB）、Cloud Map 私有命名空间 `github-name.internal` 与服务 `go-api`、安全组、RDS 入站规则、日志组 `/ecs/go-api` |
| `ServerStack` | 后端 Lambda `github-name-backend`（Hono/tRPC，512 MB，最小权限角色）、别名 `live`、CodeDeploy 灰度（10% → 5 分钟 → 100%）、2 个回滚告警、日志组 |

## 后端 Lambda 与生产灰度（ServerStack）

```
API Gateway HTTP API ewkw4pdc50 ──▶ github-name-backend:live
                                      ├─ 新版本 10% ┐ CodeDeploy：5 分钟后 100%
                                      └─ 旧版本 90% ┘ 告警触发自动回滚
```

- 运行在现有 VPC 私有子网，复用 Lambda 安全组 `sg-09b7…`（RDS / Go 服务的放行规则不变）
- `DATABASE_URL` 部署时从 Secrets Manager `server/database-url` 解析；`CORS_ORIGIN` 等在 `cdk.json`（`server*` 键）
- 回滚告警：`github-name-backend-errors`（1 分钟内错误 ≥ 3）、`github-name-backend-p95-duration`（p95 > 3 秒，连续 2 分钟）
- 设置 `-c serverGoApiUrl=http://go-api.github-name.internal:8080`（或写进 `cdk.json`）即让列表读取走 Go 服务

```sh
pnpm --filter infra deploy:server     # 构建后端 bundle 并部署；代码或配置变化 → 新版本 → 自动灰度
```

首次部署（新函数创建）不经过灰度。之后每次部署在 CodeDeploy 控制台（开发人员工具 → CodeDeploy → 部署）可看到进度，也可手动停止（停止即回滚）。

### 从控制台建的旧函数切换过来（一次性）

旧函数 `github-name-server`（`$LATEST`、`PowerUserRole`）仍在接流量，直到把 API Gateway 两个集成改指向新别名：

```sh
ALIAS=arn:aws:lambda:ap-southeast-2:314068109968:function:github-name-backend:live
for id in lulpkd3 qe9hn1h; do aws apigatewayv2 update-integration --api-id ewkw4pdc50 --integration-id $id --integration-uri $ALIAS; done
```

回滚：把 `--integration-uri` 换回 `arn:aws:lambda:ap-southeast-2:314068109968:function:github-name-server` 再执行一次。观察稳定后再删除旧函数。

## 服务拓扑（GoApiServiceStack）

```
Lambda (sg github-name-lambda-sg)
  ──DNS─────▶ go-api.github-name.internal（Cloud Map 私有 DNS，解析为任务私有 IP）
  ──HTTP 8080──▶ Fargate 任务（私有子网，只放行 Lambda 安全组，无公网 IP）
                    ──5432──▶ RDS github-name-dev-db
                    ──NAT───▶ ECR / Secrets Manager / Logs
```

- 复用现有默认 VPC `vpc-0de70fcd2f5218ab5` 及其 NAT 网关，网络参数写在 `cdk.json` 的 `context.network`
- `DATABASE_URL` 来自 Secrets Manager 密钥 `go-api/database-url`（部署前须已存在，栈只引用不创建）
- Lambda 与任务须位于关联该私有命名空间的 VPC，VPC 的 `enableDnsSupport` 和 `enableDnsHostnames` 须开启；Lambda 出站规则须允许 TCP 8080 到任务安全组
- `GO_API_URL=http://go-api.github-name.internal:8080`；使用普通 DNS 解析，不需要给 Lambda 添加 Cloud Map API 权限
- ECS 自动注册/注销任务私有 IP；DNS A 记录 TTL 为 10 秒。DNS 缓存和连接复用可能导致短暂访问旧任务，Cloud Map 不提供按请求转发或精确流量权重
- 健康检查：容器内 `/server healthcheck`，由 ECS 更新服务发现健康状态；所有实例不健康时 DNS 仍可能返回不健康地址，调用方仍需处理连接失败
- 根文件系统只读，任务停止时给 Go 服务最多 30 秒退出时间

### 滚动发布

每次以新的 `goApiImageTag` 部署时，ECS 启动新任务，待容器健康检查通过后逐步替换旧任务。`minHealthyPercent=100`、`maxHealthyPercent=200`，更新期间保留所需健康副本，允许新旧版本同时被 DNS 发现。

启用 ECS 部署断路器：新任务启动失败或健康检查不通过时，回滚到上一个成功部署（首次部署没有可回滚版本）。已移除依赖 ALB 的 10% canary 流量切换，以及 ALB 5xx / p95 告警回滚；应用错误和延迟仍需通过应用日志或自定义指标监控。

### 部署

```sh
# 指定要运行的镜像（ECR 中的 commit SHA 标签）
pnpm --filter infra deploy:service -- -c goApiImageTag=<commit sha>
```

不带 `goApiImageTag` 部署时服务副本数为 0（只建资源、不跑任务）。副本数由 `cdk.json` 的 `goApiDesiredCount` 控制（默认 1；高可用改为 2）。部署输出 `GoApiUrl`，设为 Lambda 环境变量 `GO_API_URL` 后列表读取即切到 Go 服务（见 `apps/server/LAMBDA.md`）。

### 从已有 ALB 切换

若旧栈已部署，先执行 `pnpm --filter infra diff` 检查变更，尤其是 ECS 发布策略变更和 ALB 删除。该修改会移除 ALB、监听器、目标组、ALB 安全组及相关告警；上线时须安排迁移窗口。可先移除 Lambda 的 `GO_API_URL` 让读取暂走 Prisma，部署完成并确认 Cloud Map 中有健康任务后，再将 `GO_API_URL` 设为输出的新地址，并从 Lambda 验证 `github.list`。

### 费用（悉尼，大致）

| 项 | 月费 |
| --- | --- |
| Cloud Map / Route 53 私有 DNS | 按注册资源、托管区域及查询量等计费 |
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
| `pnpm --filter infra test` | 验证 Cloud Map 注册、直连安全组及滚动发布模板 |
| `pnpm --filter infra synth` | 生成 CloudFormation 模板到 `cdk.out/`，不需要凭证 |
| `pnpm --filter infra diff` | 与线上对比 |

可调参数在 `cdk.json` 的 `context` 中：`githubRepository`、`githubBranch`、`goApiRepositoryName`、`githubConnectionReady`。ECR 仓库设为保留：删除栈时不会删除仓库及其中的镜像。

## 费用（大致）

- ECR：存储约 $0.10/GB·月，每个镜像约 10 MB
- CodeBuild `arm1.small`：按构建分钟计费，每次构建约 2–4 分钟
- CodeConnections：免费
