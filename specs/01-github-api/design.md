# 01 GitHub 人员后端能力 — 设计

## 技术背景

| 项 | 内容 | 来源 |
| --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo，内部包通过 `exports` 直接指向 `src/*.ts`，无需构建 | `AGENTS.md`、`packages/api/package.json` |
| 后端 | Hono 4（`apps/server`），`createApp()` 被 Node 入口 `index.ts` 与 Lambda 入口 `lambda.ts` 共用 | `apps/server/src/app.ts`、`index.ts`、`lambda.ts` |
| API | tRPC v11，`router` / `publicProcedure` 定义于 `packages/api/src/index.ts`，`appRouter` 于 `packages/api/src/routers/index.ts` | 同左 |
| 依赖方向 | `apps/*` → `packages/api` → `packages/db`；包只导出工厂，实例在 `apps/server/src/services.ts` 中创建并注入 context | `AGENTS.md`「架构与数据流」 |
| 数据库 | PostgreSQL + Prisma 7（`@prisma/adapter-pg`），schema 目录 `packages/db/prisma/schema/`，迁移目录 `packages/db/prisma/migrations/`；`createPrismaClient()` 工厂 | `packages/db/prisma.config.ts`、`packages/db/src/index.ts` |
| 校验 | Zod 4（catalog） | `pnpm-workspace.yaml` |
| 环境变量 | 本地用 Varlock `.env.schema` → 生成 `src/env.ts`；Lambda 构建将 `./env.server` 别名为 `env.lambda.ts`（Zod 运行时校验） | `apps/server/.env.schema`、`apps/server/tsdown.lambda.config.ts`、`apps/server/src/env.lambda.ts` |
| 本地数据库 | `pnpm db:start`（embedded-postgres），之后在 `packages/db` 直接运行 `prisma` 命令 | `packages/db/scripts/start-local-db.mjs` |
| 编码规范 | Ultracite/Biome：显式类型、`for...of`、早返回、抛出 `Error` 对象、顶层正则常量 | `AGENTS.md`「Ultracite Code Standards」 |
| 测试 | 仓库现无测试；使用 Node 内置 `node:test` + 已有依赖 `tsx` | `apps/server/package.json` |
| 命令 | `pnpm db:generate`、`pnpm check-types`；Node 需切至 v22（varlock） | `AGENTS.md`「常用命令」 |

与 AGENTS.md 的差异：AGENTS.md 目录说明中 `apps/server/src/index.ts` 被描述为路由定义处，实际路由在 `app.ts`（`index.ts` / `lambda.ts` 为入口）；以代码为准，不影响本设计。

## 设计项

- [x] DES-001 `GithubProfile` 数据模型与迁移（关联 REQ-001）
  - 实现方案：在 `schema.prisma` 新增 `model GithubProfile`（`@@map("github_profile")`），`id String @id @default(cuid())`，`githubId Int @unique`，`login String` + `@@index([login])`，可空资料字段 `String?`，`tags String[] @default([])`，`syncedAt DateTime`，`createdAt @default(now())`，`updatedAt @updatedAt`；另加 `@@index([createdAt])`、`@@index([followers])`、`@@index([publicRepos])` 支持排序。用 `prisma migrate dev --name github_profile` 生成迁移。
  - 涉及文件：`packages/db/prisma/schema/schema.prisma`；`packages/db/prisma/migrations/<时间戳>_github_profile/migration.sql`（新增）
  - 接口与数据变化：新增表 `github_profile`
  - 验证方式：迁移在本地 embedded-postgres 上应用成功；`pnpm db:generate` 与类型检查通过
  - 完成证据：迁移 `20261108120000_github_profile` 已应用到开发库（`migrate status` 显示 up to date）与测试库；`pnpm check-types` 通过

- [x] DES-002 共享校验与常量（关联 REQ-002.01、REQ-003.01、REQ-004.01、REQ-005.01）
  - 实现方案：新增 `packages/api/src/shared/github.ts`，不依赖服务端代码，供 Web / App 直接导入：`githubUsernameSchema`（trim + 正则 `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`）、`noteSchema`、`tagsSchema`（trim、去空、去重后校验）、`githubSortSchema`、常量 `NOTE_MAX_LENGTH=200`、`TAGS_MAX_COUNT=5`、`TAG_MAX_LENGTH=20`、`PAGE_SIZE=20`、`PAGE_SIZE_MAX=50`。
  - 涉及文件：`packages/api/src/shared/github.ts`（新增）
  - 接口与数据变化：新增导出 `@my-better-t-app/api/shared/github`
  - 验证方式：单元测试覆盖合法 / 非法用户名、备注与标签边界
  - 完成证据：`shared.test.ts` 4 项通过

- [x] DES-003 GitHub REST 客户端（关联 REQ-002.02、REQ-002.03、REQ-006、REQ-009）
  - 实现方案：新增 `packages/api/src/github-client.ts`，工厂 `createGithubClient({ token?, fetch?, timeoutMs = 10_000, cacheTtlMs = 60_000, now? })`，返回 `getUserByLogin(login)`、`getUserById(id)`。请求头 `Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28`、`User-Agent: my-better-t-app`，有 token 时加 `Authorization: Bearer`。用 `AbortSignal.timeout` 实现超时。响应映射为 `GithubUser`（camelCase，`githubCreatedAt: Date`）。错误抛出 `GithubError`（`kind: "not_found" | "rate_limited" | "failed"`）。`getUserByLogin` 成功结果按小写 login 缓存。token 不写日志。
  - 涉及文件：`packages/api/src/github-client.ts`（新增）
  - 接口与数据变化：新增类型 `GithubClient`、`GithubUser`、`GithubError`
  - 验证方式：注入假 `fetch` 的单元测试：映射、各错误、超时、缓存命中与过期、Authorization 头
  - 完成证据：`github-client.test.ts` 7 项通过（映射、Authorization、错误分类、超时、缓存与 fresh 绕过）；本地真实请求 torvalds 成功

- [x] DES-004 频率限制器与客户端 IP（关联 REQ-008）
  - 实现方案：新增 `packages/api/src/rate-limit.ts`，`createRateLimiter({ limit, windowMs, now? })` 返回 `consume(key): boolean`（固定窗口计数，Map 存 `{count, resetAt}`，键数过多时清理过期项）。`packages/api/src/index.ts` 新增 `rateLimitedProcedure`：调用 `ctx.rateLimiter.consume(ctx.clientIp ?? "unknown")`，失败抛 `TOO_MANY_REQUESTS`。`apps/server/src/app.ts` 的 `createApp(getClientIp)` 接收取 IP 函数；`index.ts` 用 `@hono/node-server/conninfo` 的 `getConnInfo`，`lambda.ts` 用 `hono/aws-lambda` 的 `getConnInfo`；去掉 `::ffff:` 前缀。
  - 涉及文件：`packages/api/src/rate-limit.ts`（新增）、`packages/api/src/index.ts`、`packages/api/src/context.ts`、`apps/server/src/app.ts`、`apps/server/src/index.ts`、`apps/server/src/lambda.ts`、`apps/server/src/context.ts`
  - 接口与数据变化：`Context` 增加 `github`、`rateLimiter`、`clientIp`
  - 验证方式：单元测试（计数、窗口重置、不同键独立）；HTTP 测试第 31 次调用返回 429
  - 完成证据：`rate-limit.test.ts` 2 项、`http.test.ts` 限流用例（第 31 次 429、其他 IP 与 list 不受影响）通过

- [x] DES-005 `github` tRPC 路由（关联 REQ-002 – REQ-007）
  - 实现方案：新增 `packages/api/src/routers/github.ts` 并在 `appRouter` 中以 `github` 合并。
    - `search`（query，限流）：`getUserByLogin` → 按 `githubId` 查是否存在 → 返回 `{ ...user, existsInSystem }`。
    - `list`（query）：`where` 为 `OR [login|name|note contains keyword, mode: insensitive]`；`orderBy [{ [sort]: "desc" }, { id: "desc" }]`；`take: limit + 1`；cursor 记录存在时用 `cursor: { id }, skip: 1`，不存在时忽略；`total` 用同一 `where` 计数。
    - `create`（mutation，限流）：先查重 → 拉取资料 → `create`；捕获 Prisma `P2002` → `CONFLICT`。
    - `update`（mutation，限流）：只更新传入字段，`P2025` → `NOT_FOUND`。
    - `sync`（mutation，限流）：查记录 → `getUserById(githubId)` → 更新资料字段与 `syncedAt`；GitHub not_found → `NOT_FOUND`「该 GitHub 用户已不存在」。
    - `delete`（mutation，限流）：`P2025` → `NOT_FOUND`。
    - 公共函数 `toTrpcError(error)` 实现 REQ-002.02 的映射；`profileDataFromGithub(user)` 生成写库字段。
  - 涉及文件：`packages/api/src/routers/github.ts`（新增）、`packages/api/src/routers/index.ts`
  - 接口与数据变化：新增 6 个 tRPC 过程（输出类型经 `AppRouter` 推导给前端）
  - 验证方式：集成测试（真实 PostgreSQL + 假 GitHub 客户端）覆盖各过程的正常与异常路径
  - 完成证据：`github-router.test.ts` 13 项通过；CR 修复：create 使用 `fresh: true` 不复用搜索缓存

- [x] DES-006 服务装配与 `GITHUB_TOKEN`（关联 REQ-009）
  - 实现方案：`apps/server/.env.schema` 新增可选敏感变量 `GITHUB_TOKEN`，运行 `pnpm env:generate`；`env.lambda.ts` 增加 `GITHUB_TOKEN: z.string().min(1).optional()`；`services.ts` 创建 `github` 与 `rateLimiter`（30 次 / 60 秒）；`context.ts` 注入；`turbo.json` `globalEnv` 加入 `GITHUB_TOKEN`；`LAMBDA.md` 环境变量表补充（可选）。
  - 涉及文件：`apps/server/.env.schema`、`apps/server/src/env.ts`（生成）、`apps/server/src/env.lambda.ts`、`apps/server/src/services.ts`、`apps/server/src/context.ts`、`turbo.json`、`apps/server/LAMBDA.md`
  - 接口与数据变化：新增可选环境变量 `GITHUB_TOKEN`
  - 验证方式：未配置令牌时服务启动、`/trpc/healthCheck` 返回 OK；`pnpm --filter server build:lambda` 成功
  - 完成证据：未配置 `GITHUB_TOKEN` 时服务启动且 healthCheck 返回 OK；`build:lambda` 成功

- [x] DES-007 服务端自动化测试（关联 REQ-001 – REQ-009）
  - 实现方案：`apps/server/test/` 下用 `node:test` + `tsx`：`shared.test.ts`、`github-client.test.ts`、`rate-limit.test.ts`（纯单元）；`github-router.test.ts` 使用 `appRouter.createCaller(ctx)`，`ctx.db` 为连接本地 PostgreSQL 的 Prisma 实例（每个用例前清空 `github_profile`），`ctx.github` 为内存假客户端；`http.test.ts` 用 `createApp().request()` 验证 tRPC HTTP 层错误码与限流。`apps/server/package.json` 增加 `test` 脚本。
  - 涉及文件：`apps/server/test/*.test.ts`（新增）、`apps/server/test/helpers.ts`（新增）、`apps/server/package.json`
  - 接口与数据变化：无
  - 验证方式：`pnpm db:start` 后 `pnpm --filter server test` 全部通过
  - 完成证据：`pnpm --filter server test` 29/29 通过

## 待确认项

- 无需引入新依赖；测试使用 Node 内置 `node:test` 与已有 `tsx`。
