# 当前开发与发布流程

以下根据仓库中的工作流、CDK Stack 和 `cdk.json` 绘制，描述当前代码配置；未检查 AWS 或 Cloudflare 的实际部署状态。

## 开发与发布

```mermaid
flowchart TD
    Dev[本地开发与联调] --> Change{改动内容}

    Change --> Web[Web 前端 apps/web]
    Web --> Main[推送或合并到 main]
    Main --> WebCI[GitHub Actions: deploy-web]
    WebCI --> WebBuild[生成 Prisma Client / 构建 Next.js]
    WebBuild --> CF[自动部署到 Cloudflare Workers]

    Change --> Go[Go API: 独立仓库 go-api]
    Go --> GoCI[PR / main 触发 go-api 仓库 CI]
    GoCI --> Test[go vet / race 测试 / PostgreSQL 集成测试]
    Test --> Event{是否为 push 或手动触发}
    Event -->|PR: 只测试| Review[检查结果 / 代码评审]
    Event -->|push 或手动触发| Image[构建 linux/arm64 镜像]
    Image --> ECR[ECR 私有仓库: go-api / 标签为 commit SHA]
    ECR --> DeployGo[手动 CDK deploy:service / 指定镜像 SHA]
    DeployGo --> ECS[ECS Fargate 滚动更新]
    ECS --> Health{容器健康检查}
    Health -->|通过| Register[Cloud Map 更新任务地址]
    Health -->|部署失败| RollbackGo[部署断路器回滚到上次成功版本]

    Change --> Server[Hono / tRPC / 共享 API 代码]
    Server --> Check[本地检查与验证]
    Check --> DeployServer[手动 CDK deploy:server]
    DeployServer --> Bundle[构建 Lambda bundle / 发布新版本]
    Bundle --> Canary[CodeDeploy: live 别名 / 10% 流量观察 5 分钟]
    Canary -->|成功| Lambda[新版本接收 100% 流量]
    Canary -->|告警或部署失败| RollbackLambda[回滚 live 别名]

    Change --> Infra[基础设施 apps/infra]
    Infra --> Validate[类型检查 / 模板测试 / synth / diff]
    Validate --> Stack[手动部署对应 CDK Stack]
```

- **Go CI 触发条件**：PR 或指定分支的 push 须匹配 Go API、Prisma 迁移或该 CI 文件的路径过滤；也可手动运行。PR 不推镜像。`feat/go-api` 是临时构建分支。
- **当前镜像构建路径**：GitHub Actions 使用限定到 `go-api` 仓库的 IAM 用户凭证推送镜像。`githubActionsPushUser=true`，属于 CodeBuild 配额到位前的过渡方案。
- **CodeBuild 后续路径**：代码仍配置了 `main` 上 Go API 改动触发 CodeBuild，经 CodeConnections 拉代码、测试、构建并推送 ECR。配额可用后按项目说明移除 GitHub 镜像任务、密钥和临时 IAM 用户；这条路径也不会自动部署 ECS。
- **发布是独立步骤**：镜像进入 ECR 后，仍须指定 SHA 执行 `deploy:service`；当前未配置 Go API 或 Lambda 的自动部署工作流。
- **Lambda 首次创建**不经过灰度；后续版本发布才使用 `live` 别名灰度。API Gateway 集成须已切到新函数的 `live` 别名，才会经过这套发布链路。
- **数据库改动**：在 Prisma schema 中修改模型、生成并提交迁移；在能访问目标数据库的环境单独执行迁移，再部署依赖它的服务。镜像构建不会自动迁移生产数据库。

## 运行时调用

```mermaid
flowchart LR
    User[用户浏览器] --> Web[Web / Cloudflare Workers]
    Web -->|HTTP tRPC| Gateway[API Gateway HTTP API]
    Native[Expo 移动端] -->|HTTP tRPC| Gateway
    Gateway --> Alias[Lambda live 别名]

    subgraph VPC[现有 AWS VPC]
        Alias --> Hono[Hono / tRPC 后端]
        Hono -.->|DNS 查询| Map[Cloud Map 私有 DNS]
        Map -.->|返回任务私有 IP| Hono
        Hono -->|全部人员数据读写: HTTP 8080| Go[Go API / ECS Fargate]
        Go -->|pgx / SQL| DB[(RDS PostgreSQL)]
    end
```

`serverGoApiUrl` 当前配置为 `http://go-api.github-name.internal:8080`，部署时映射为 Lambda 的 `GO_API_URL`。未设置该值时，后端改用 Prisma 直连数据库。Cloud Map 只负责发现地址，业务请求由 Lambda 直接发到 Go 任务，不经过 ALB。

API Gateway 是否已从旧函数切到 `github-name-backend:live`，须在 AWS 检查；迁移步骤见 [基础设施 README](README.md)。

## 常用操作

在仓库根目录运行：

| 操作 | 命令 |
| --- | --- |
| 本地 Web | `pnpm dev:web` |
| 本地 Hono 后端 | `pnpm dev:server` |
| 本地 Go 服务 | `pnpm --filter go-api start:local` |
| 本地移动端 | `pnpm dev:native` |
| 检查基础设施类型 | `pnpm --filter infra check-types` |
| 运行基础设施模板测试 | `pnpm --filter infra test` |
| 生成 / 比较基础设施模板 | `pnpm --filter infra synth` / `pnpm --filter infra diff` |
| 部署 Go 指定镜像 | `pnpm --filter infra deploy:service -- -c goApiImageTag=<commit-sha>` |
| 构建并部署 Lambda | `pnpm --filter infra deploy:server` |

本地 Hono 联调本地 Go 时，将 `GO_API_URL` 设为 `http://localhost:8080`；Cloud Map 私有域名用于 VPC 内调用。
