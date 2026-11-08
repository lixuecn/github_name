# 01 GitHub 人员后端能力 — 任务

环境：Node 22、embedded-postgres、Codex CLI 均可用，无阻塞。

- [x] TASK-001 数据模型与迁移
  - 关联：REQ-001；DES-001
  - 工作：新增 `GithubProfile` 模型；启动本地 PostgreSQL，生成并应用迁移；重新生成 Prisma Client
  - 文件：`packages/db/prisma/schema/schema.prisma`、`packages/db/prisma/migrations/*_github_profile/migration.sql`
  - 依赖：无
  - 验证：`prisma migrate dev` 成功；`pnpm check-types` 通过

- [x] TASK-002 共享校验模块
  - 关联：REQ-002.01、REQ-003.01、REQ-004.01、REQ-005.01；DES-002
  - 工作：实现用户名、备注、标签、排序的 Zod schema 与常量
  - 文件：`packages/api/src/shared/github.ts`
  - 依赖：无
  - 验证：`shared.test.ts`

- [x] TASK-003 GitHub 客户端
  - 关联：REQ-002.02、REQ-002.03、REQ-006、REQ-009；DES-003
  - 工作：实现 `createGithubClient`、错误分类、超时、缓存
  - 文件：`packages/api/src/github-client.ts`
  - 依赖：无
  - 验证：`github-client.test.ts`

- [x] TASK-004 频率限制与上下文
  - 关联：REQ-008；DES-004
  - 工作：
    - [x] TASK-004.01 实现 `createRateLimiter` 与 `rateLimitedProcedure`
    - [x] TASK-004.02 扩展 `Context`；`createApp(getClientIp)`，Node 与 Lambda 入口传入取 IP 函数
  - 文件：`packages/api/src/rate-limit.ts`、`packages/api/src/index.ts`、`packages/api/src/context.ts`、`apps/server/src/app.ts`、`apps/server/src/index.ts`、`apps/server/src/lambda.ts`、`apps/server/src/context.ts`
  - 依赖：TASK-003（Context 类型引用 `GithubClient`）
  - 验证：`rate-limit.test.ts`、`http.test.ts`

- [x] TASK-005 `github` 路由
  - 关联：REQ-002 – REQ-007；DES-005
  - 工作：实现 search / list / create / update / sync / delete，合并进 `appRouter`
  - 文件：`packages/api/src/routers/github.ts`、`packages/api/src/routers/index.ts`
  - 依赖：TASK-001、TASK-002、TASK-003、TASK-004
  - 验证：`github-router.test.ts`

- [x] TASK-006 服务装配与环境变量
  - 关联：REQ-009；DES-006
  - 工作：声明 `GITHUB_TOKEN`，生成 env 类型，Lambda 环境校验，`services.ts` 创建实例，更新 `turbo.json` 与 `LAMBDA.md`
  - 文件：`apps/server/.env.schema`、`apps/server/src/env.ts`、`apps/server/src/env.lambda.ts`、`apps/server/src/services.ts`、`apps/server/src/context.ts`、`turbo.json`、`apps/server/LAMBDA.md`
  - 依赖：TASK-003、TASK-004
  - 验证：服务启动、`healthCheck` 返回 OK；`pnpm --filter server build:lambda` 成功

- [x] TASK-007 自动化测试
  - 关联：REQ-001 – REQ-009；DES-007
  - 工作：编写单元、集成与 HTTP 测试，新增 `test` 脚本
  - 文件：`apps/server/test/*.ts`、`apps/server/package.json`
  - 依赖：TASK-001 – TASK-006
  - 验证：`pnpm --filter server test` 全部通过；`pnpm check-types` 通过

- [x] TASK-008 Codex CR、品审与修复
  - 关联：全部；DES-001 – DES-007
  - 工作：运行 Codex review，逐条核实并修复确认的问题，未修复项在此注明理由
  - 依赖：TASK-001 – TASK-007
  - 验证：修复后重新运行 TASK-007 的测试

## 完成记录（2026-11-08）

- 改动文件：`packages/db/prisma/schema/schema.prisma`、`packages/db/prisma/migrations/20261108120000_github_profile/migration.sql`（新增）、`packages/api/src/{shared/github.ts,github-client.ts,rate-limit.ts,routers/github.ts}`（新增）、`packages/api/src/{context.ts,index.ts,routers/index.ts}`、`apps/server/src/{app.ts,index.ts,lambda.ts,context.ts,services.ts,env.lambda.ts,env.ts}`、`apps/server/.env.schema`、`apps/server/LAMBDA.md`、`turbo.json`、`apps/server/package.json`、`apps/server/test/*`（新增）。
- 测试：`pnpm --filter server test` 29/29 通过（shared 4、github-client 7、rate-limit 2、github-router 13、http 3）；`pnpm check-types` 6/6 通过；`pnpm --filter server build:lambda` 成功；本地服务 `github.search({username:"torvalds"})` 返回真实 GitHub 数据。
- 迁移说明：本地开发库残留旧 auth 表导致 `migrate dev` 要求 reset（被权限拦截），改用 `migrate diff` 生成 SQL + `db execute` + `migrate resolve --applied` 无损应用；旧 auth 表未删除，是否清理由用户决定。测试使用独立库 `postgres_github_test`。
- 并行说明：TASK-002 与 TASK-003 互不依赖，但仓库存在大量未提交改动（认证移除），worktree 基于 HEAD 会拿到不一致的代码基线，故按依赖顺序串行开发。
- Codex CR（TASK-008）：1 条 P2「create 复用了 60 秒搜索缓存，未按要求重新拉取」——核实成立，已修复：`getUserByLogin(login, { fresh: true })` 跳过缓存读取，`create` 使用该选项；新增 2 处测试断言。无未修复项。
