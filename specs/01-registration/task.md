# 01 注册 — 任务

- [x] TASK-001 服务端用户名认证配置
  - 关联：REQ-001、REQ-002.01、DES-001、DES-003、DES-004
  - 工作：
    - [x] TASK-001.01 新增 `packages/auth/src/username.ts`：用户名规则常量与占位邮箱生成函数
    - [x] TASK-001.02 `createAuth()` 加入 `username()` 插件
    - [x] TASK-001.03 加入 `hooks.before`：强制 username、覆盖 email
    - [x] TASK-001.04 开启 `rateLimit` 与自定义规则
  - 涉及文件：`packages/auth/src/index.ts`、`packages/auth/src/username.ts`
  - 前置依赖：无
  - 验证：`pnpm check-types`

- [x] TASK-002 数据库结构同步
  - 关联：REQ-001.01、DES-002
  - 工作：`pnpm auth:generate` → `pnpm db:generate` → `pnpm db:push`
  - 涉及文件：`packages/db/prisma/schema/auth.prisma`
  - 前置依赖：TASK-001；可用的 PostgreSQL（Q-103）
  - 验证：`db:push` 成功，`user` 表出现 `username` 唯一约束

- [x] TASK-003 客户端插件与错误映射
  - 关联：REQ-003.01、REQ-003.04、DES-005
  - 工作：Web / Native `authClient` 加 `usernameClient()`；新增两端 `auth-errors.ts`
  - 涉及文件：`apps/web/src/lib/auth-client.ts`、`apps/web/src/lib/auth-errors.ts`、`apps/native/lib/auth-client.ts`、`apps/native/lib/auth-errors.ts`
  - 前置依赖：TASK-001
  - 验证：`pnpm check-types`

- [x] TASK-004 Web 注册表单
  - 关联：REQ-002、REQ-003、REQ-004、DES-006
  - 工作：改写 `SignUpForm` 为用户名 + 密码 + 确认密码，中文文案
  - 涉及文件：`apps/web/src/components/sign-up-form.tsx`
  - 前置依赖：TASK-003
  - 验证：Web 端到端测试（TASK-007）

- [x] TASK-005 Native 注册表单
  - 关联：REQ-002、REQ-003、REQ-004、DES-007
  - 工作：改写 `SignUp` 组件，中文文案
  - 涉及文件：`apps/native/components/sign-up.tsx`
  - 前置依赖：TASK-003
  - 验证：`pnpm check-types`；模拟器 UI 测试（Q-102）

- [x] TASK-006 服务端集成测试
  - 关联：REQ-001、REQ-002（服务端校验）、REQ-003.01、DES-008
  - 工作：新增 `apps/server/test/registration.test.ts`、`test` 脚本与 turbo 任务；覆盖：注册成功与归一化、占位邮箱覆盖、缺少 username 拒绝、非法用户名拒绝、重复用户名（大小写）拒绝、频率限制 429
  - 涉及文件：`apps/server/test/registration.test.ts`、`apps/server/package.json`、`turbo.json`
  - 前置依赖：TASK-002
  - 验证：`pnpm --filter server test` 通过

- [x] TASK-007 Web 注册端到端测试
  - 关联：REQ-002、REQ-003、REQ-004、DES-008
  - 工作：引入 Playwright（Q-101），新增 `playwright.config.ts` 与 `e2e/registration.spec.ts`；覆盖：各项表单校验、注册成功跳转 `/dashboard`、重复注册提示、页面无邮箱字段
  - 涉及文件：`apps/web/playwright.config.ts`、`apps/web/e2e/registration.spec.ts`、`apps/web/package.json`（均未创建：用户决定不引入 Playwright）
  - 前置依赖：TASK-002、TASK-004
  - 验证：`pnpm --filter web test:e2e` 通过

- [ ] TASK-008 质量检查
  - 关联：全部
  - 工作：`pnpm check-types`、`pnpm check`
  - 前置依赖：TASK-001 至 TASK-007
  - 验证：两条命令均通过

## 进度记录（2026-11-03）

- 改动文件：`packages/auth/src/index.ts`、`packages/auth/src/username.ts`（新增）、`packages/db/prisma/schema/auth.prisma`、`apps/web/src/lib/auth-client.ts`、`apps/web/src/lib/auth-errors.ts`（新增）、`apps/web/src/components/sign-up-form.tsx`、`apps/native/lib/auth-client.ts`、`apps/native/lib/auth-errors.ts`（新增）、`apps/native/components/sign-up.tsx`、`apps/server/test/helpers.ts`（新增）、`apps/server/test/registration.test.ts`（新增）、`apps/server/package.json`、`turbo.json`
- 测试结果：`pnpm --filter server test` 6/6 通过；`pnpm check-types` 7/7 通过；`prisma db push` 成功。
- TASK-004：仅以类型检查与服务端接口测试验证，表单交互未做端到端验证（[Q-101](design.md#差异与待确认项)）。
- TASK-005：用户决定 Native 不做 UI 测试，以类型检查验证（[Q-102](design.md#差异与待确认项)）。
- TASK-007 未完成：用户决定不引入 Playwright，Web 端到端验收未验证。
- TASK-008 未完成：`pnpm check` 改动前即失败（[Q-105](design.md#差异与待确认项)）；改动文件已用临时修正配置检查，仅剩与仓库现有风格一致的格式（2 空格）与模板沿用写法。
- Codex CR：1 条 P1「禁用 `/sign-in/email` 时登录表单仍在调用」——品审成立，已修复（`disabledPaths` 移至 [02-login TASK-001](../02-login/task.md) 与表单迁移同改）。
- TASK-007 更新：未引入 Playwright，改为浏览器实测：本机 Chrome（headless，CDP 驱动，无新增依赖）对 `pnpm db:start` 的项目内数据库跑通 26/26 项检查（2026-11-03）；脚本位于会话临时目录，未入库。覆盖：表单校验、注册成功跳转、重复注册提示、页面无邮箱字段。
- 数据库更新：本地 PostgreSQL 改为项目内运行——`pnpm db:start`（`packages/db/scripts/start-local-db.mjs`，devDependency `embedded-postgres@17.11.0-beta.19`，数据位于已 gitignore 的 `packages/db/.local-postgres`，`pnpm-workspace.yaml` 的 `allowBuilds` 放行其 postinstall），切换后服务端测试 15/15 通过。
