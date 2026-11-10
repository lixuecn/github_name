# go-api

Go 编写的内部数据服务，读写 `github_profile` 表，供 Lambda（`apps/server`）在内网调用。目标部署形态：GitHub → Docker 镜像 → ECR → ECS Fargate，前面接 ALB 或 Cloud Map。

- 技术选型：标准库 `net/http`（Go 1.22+ 路由）、`pgx/v5` 连接池、`sqlc` 生成类型安全的查询代码、`log/slog` JSON 日志
- **表结构归 Prisma 管**：sqlc 只读取 `packages/db/prisma/migrations` 下的迁移 SQL，Go 服务不执行任何 DDL
- **无认证**：只能部署在私有子网，安全组只放行 Lambda

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 存活检查，不访问数据库（给 ALB / ECS 用） |
| GET | `/ready` | 就绪检查，`Ping` 数据库，不可用时返回 503 |
| GET | `/profiles?keyword=&sort=&limit=&cursor=` | 分页列表，语义与 tRPC `github.list` 一致：`sort` 为 `createdAt`（默认）/ `followers` / `publicRepos`，倒序；`limit` 1–50，默认 20；关键字匹配用户名 / 昵称 / 备注（不区分大小写，`%` `_` 按字面匹配）；游标对应的行已删除时从第一页开始 |
| GET | `/profiles/{id}` | 单条记录，不存在返回 404 |
| POST | `/profiles` | 插入。请求体为 GitHub 资料字段加 `note`、`tags`，校验规则同 `packages/api/src/shared/github.ts`；`githubId` 重复返回 409 |

返回体字段与 Prisma 模型一致（camelCase，时间为 UTC ISO 8601）。错误统一为：

```json
{ "error": { "code": "NOT_FOUND", "message": "该人员不存在" } }
```

## 本地开发

需要 Go 1.27+。数据库连接复用 `apps/server/.env` 里的 `DATABASE_URL`。

```sh
pnpm db:start                          # 仓库根目录，启动本地 PostgreSQL
pnpm --filter go-api start:local       # 默认端口 8080，可用 PORT 覆盖
curl localhost:8080/profiles
```

| 命令 | 作用 |
| --- | --- |
| `pnpm --filter go-api test` | 单元测试（无需数据库） |
| `GO_API_TEST_DATABASE_URL=postgresql://... go test ./...` | 同时运行数据库集成测试：每次在临时 schema 中执行 Prisma 迁移，结束后删除，不影响业务表 |
| `pnpm --filter go-api check-types` | `go vet` |
| `pnpm --filter go-api build` | 编译到 `dist/server` |
| `pnpm --filter go-api sqlc:generate` | 修改 `internal/store/queries/*.sql` 后重新生成代码 |

Prisma 新增迁移后：把新的 `migration.sql` 加进 `sqlc.yaml` 的 `schema` 列表，再运行 `sqlc:generate`。

## 镜像与部署

```sh
docker buildx build --platform linux/arm64 -t go-api .   # 在 apps/go-api 目录下
```

- 基础镜像为 distroless（非 root 运行，约 10 MB 二进制），内置 Amazon RDS CA 证书
- 容器健康检查用 `/server healthcheck`（镜像里没有 curl）
- 收到 `SIGTERM` 后最多等待 20 秒处理完在途请求，小于 ECS 默认的 30 秒 `stopTimeout`

ECS 任务定义里的环境变量：

| 键 | 值 |
| --- | --- |
| `DATABASE_URL` | `postgresql://user:pass@RDS端点:5432/db?sslmode=verify-full&sslrootcert=/etc/ssl/certs/rds-global-bundle.pem`，建议通过 Secrets Manager 注入 |
| `PORT` | 可选，默认 `8080` |

连接池参数可以写在 URL 里，例如 `&pool_max_conns=10`。
