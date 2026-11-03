# 01 注册 — 设计

## 技术背景

- 技术栈：Better Auth 1.7.12（邮箱密码 + `@better-auth/expo`）、Prisma 7 + PostgreSQL、Hono、Next.js 16、Expo 58 + HeroUI Native、TanStack Form、Zod 4。来源：`AGENTS.md`「技术栈总览」、`pnpm-workspace.yaml`（catalog 中 `better-auth: 1.7.12`）。
- 架构分层：认证工厂 `createAuth()` 位于 `packages/auth/src/index.ts`，实例在 `apps/server/src/services.ts` 创建，`/api/auth/*` 由 `apps/server/src/index.ts` 转发给 Better Auth。来源：`AGENTS.md`「架构与数据流」、对应源码。
- 数据库：Prisma schema 位于 `packages/db/prisma/schema/`，`auth.prisma` 由 `pnpm auth:generate` 生成，不手改；结构变更后运行 `pnpm db:generate` + `pnpm db:push`。来源：`AGENTS.md`「常见开发任务」、根 `package.json`。
- 可复用模块：
  - Web：`apps/web/src/components/sign-up-form.tsx`（TanStack Form + Zod 表单骨架）、`@my-better-t-app/ui/components/{button,input,label}`、`apps/web/src/lib/auth-client.ts`、`sonner` toast。来源：源码。
  - Native：`apps/native/components/sign-up.tsx`（HeroUI `TextField`/`FieldError`/`useToast`）、`apps/native/lib/auth-client.ts`。来源：源码。
- 编码规范：Ultracite / Biome，`pnpm check`、`pnpm fix`。来源：`AGENTS.md`「Quick Reference」。
- 测试命令：`pnpm check-types`、`pnpm check`；项目尚无测试框架（各 `package.json` 无 test 脚本）。来源：根与各包 `package.json`。
- 运行环境：varlock 需 Node ≥ 20.12（本机默认 v21.2.0 不满足，需使用 v22）；`DATABASE_URL` 指向本机 `localhost:5432`。来源：实际运行结果。
- 第三方文档：`username` 插件注册仍走 `signUp.email`（`email`、`name` 必填），错误码 `USERNAME_IS_ALREADY_TAKEN`、`USERNAME_TOO_SHORT`、`USERNAME_TOO_LONG`、`INVALID_USERNAME`。来源：Better Auth 文档 `/docs/plugins/username`。

## 设计项

- [x] DES-001 服务端启用用户名认证（关联 REQ-001.01、REQ-002.01）
  - 实现方案：在 `createAuth()` 的 `plugins` 中加入 `username({ minUsernameLength: 3, maxUsernameLength: 20, usernameValidator: (v) => /^[a-zA-Z0-9_]+$/.test(v) })`，保留默认小写归一化。
  - 涉及文件：`packages/auth/src/index.ts`
  - 接口与数据变化：新增 `/sign-in/username`、`/is-username-available` 端点；`signUpEmail` 支持 `username` 字段。
  - 验证方式：服务端集成测试注册 `TestUser` 后查询 `username = testuser`；提交 `a-b` 返回 4xx。
  - 完成证据：`packages/auth/src/index.ts` 启用 `username()`；registration.test.ts「normalizes the username」「break the format rules」通过

- [x] DES-002 数据库新增用户名字段（关联 REQ-001.01）
  - 实现方案：运行 `pnpm auth:generate` 重新生成 `auth.prisma`，再 `pnpm db:generate`、`pnpm db:push` 同步到数据库。
  - 涉及文件：`packages/db/prisma/schema/auth.prisma`（生成）、`packages/db/prisma/generated/`（生成，已被 gitignore）
  - 接口与数据变化：`user` 表新增 `username String? @unique`、`displayUsername String?`。
  - 验证方式：`pnpm db:push` 成功；集成测试重复用户名注册失败。
  - 完成证据：`auth.prisma` 新增 `username @unique`、`displayUsername`；`prisma db push` 成功

- [x] DES-003 注册时生成占位邮箱并强制要求用户名（关联 REQ-001.02、Q-001）
  - 实现方案：在 `createAuth()` 中配置 `hooks.before`（`createAuthMiddleware`，来自 `better-auth/api`）：当 `ctx.path === "/sign-up/email"` 时，若 body 中无合法 `username` 则抛出 `APIError("BAD_REQUEST")`；否则用 `<小写用户名>@users.invalid` 覆盖 `body.email`。占位邮箱的生成函数放在 `packages/auth/src/username.ts`（新增）。客户端按类型要求传 `email: ""`，以服务端覆盖为准。
  - 涉及文件：`packages/auth/src/index.ts`、`packages/auth/src/username.ts`（新增）
  - 接口与数据变化：`/sign-up/email` 必须携带 `username`；`user.email` 恒为占位邮箱。
  - 验证方式：集成测试传入 `email=a@b.com` 注册后检查数据库 email；不带 username 注册返回 400。
  - 完成证据：`hooks.before` + `username.ts`；registration.test.ts「placeholder」「without a username」通过

- [x] DES-004 注册 / 登录频率限制（关联 REQ-001.03、REQ-003.04、Q-002）
  - 实现方案：`createAuth()` 中设置 `rateLimit: { enabled: true, customRules: { "/sign-up/email": { window: 60, max: 5 }, "/sign-in/username": { window: 60, max: 5 } } }`，存储使用默认内存。开发环境也开启，便于验收。
  - 涉及文件：`packages/auth/src/index.ts`、`apps/server/src/index.ts`
  - 接口与数据变化：超限返回 HTTP 429。
  - 验证方式：集成测试同一来源连续发起 6 次注册，第 6 次返回 429。
  - 完成证据：`rateLimit.customRules`；registration.test.ts「rate limits」第 6 次返回 429；按 03 的 Codex CR 补充按 socket 对端区分客户端（`apps/server/src/index.ts`、`trustedProxies`），其他客户端不受影响

- [x] DES-005 客户端启用用户名插件与中文错误映射（关联 REQ-003.01、REQ-003.04）
  - 实现方案：
    - Web `authClient` 与 Native `authClient` 的 `plugins` 加入 `usernameClient()`（来自 `better-auth/client/plugins`）。
    - 新增错误映射函数 `getAuthErrorMessage(error, fallback)`：`USERNAME_IS_ALREADY_TAKEN` / `USER_ALREADY_EXISTS` → 「该用户名已被注册」，`INVALID_USERNAME_OR_PASSWORD` → 「用户名或密码错误」（供 [02-login](../02-login/design.md) 复用），HTTP 429 → 「请求过于频繁，请稍后再试」，其余返回 `fallback`。Web 与 Native 各一份（两端依赖不同，不共享包）。
  - 涉及文件：`apps/web/src/lib/auth-client.ts`、`apps/web/src/lib/auth-errors.ts`（新增）、`apps/native/lib/auth-client.ts`、`apps/native/lib/auth-errors.ts`（新增）
  - 接口与数据变化：客户端新增 `authClient.signIn.username`。
  - 验证方式：`pnpm check-types`；Web 端到端测试重复注册时出现「该用户名已被注册」。
  - 完成证据：两端 `auth-client.ts` 加 `usernameClient()`、新增 `auth-errors.ts`；`check-types` 通过；重复注册返回 `USERNAME_IS_ALREADY_TAKEN`（测试通过）

- [x] DES-006 Web 注册表单（关联 REQ-002、REQ-003.02、REQ-003.03、REQ-004）
  - 实现方案：改写 `SignUpForm`：字段为 `username`、`password`、`confirmPassword`；Zod schema 用 `.refine` 校验两次密码一致（错误挂到 `confirmPassword`）；调用 `authClient.signUp.email({ email: "", name: username, username, password })`；成功后 `router.push("/dashboard")` + `toast.success("注册成功")`；失败用 `getAuthErrorMessage(error, "注册失败，请稍后再试")`；按钮提交中显示「注册中…」并禁用；全部中文文案。
  - 涉及文件：`apps/web/src/components/sign-up-form.tsx`
  - 接口与数据变化：无
  - 验证方式：Web 端到端测试：校验错误、注册成功跳转、重复注册提示。
  - 完成证据：`sign-up-form.tsx` 改写；浏览器实测：本机 Chrome（headless，CDP 驱动，无新增依赖）对 `pnpm db:start` 的项目内数据库跑通 26/26 项检查（2026-11-03）；脚本位于会话临时目录，未入库：用户名过短/格式错误、密码过短、两次不一致提示，注册成功跳转 `/dashboard` 并提示，大小写不同的重复用户名提示「该用户名已被注册」，页面无邮箱

- [x] DES-007 Native 注册表单（关联 REQ-002、REQ-003.02、REQ-003.03、REQ-004）
  - 实现方案：改写 `SignUp` 组件：字段同 Web，键盘 `returnKeyType` 依次跳转，最后一项回车提交；`autoCapitalize="none"`；成功后 `toast.show({ variant: "success", label: "注册成功" })` 并 `queryClient.refetchQueries()`；中文文案。
  - 涉及文件：`apps/native/components/sign-up.tsx`
  - 接口与数据变化：无
  - 验证方式：`pnpm check-types`；模拟器 UI 测试（见待确认项 Q-102）。
  - 完成证据：`apps/native/components/sign-up.tsx` 改写；`check-types` 通过；按用户决定不做 UI 测试

- [x] DES-008 测试基础设施（关联本目录全部验收，供 02–04 复用）
  - 实现方案：
    - 服务端集成测试：使用 Node 内置 `node:test` + 已有的 `tsx`（`tsx --test`），不新增依赖。测试启动真实 server（`apps/server/src/index.ts`）并通过 HTTP 调用 `/api/auth/*`、`/trpc/*`，用 `pg` 校验数据库。在 `apps/server/package.json` 增加 `test` 脚本，`turbo.json` 增加 `test` 任务。
    - Web 端到端测试：原计划引入 `@playwright/test`；用户决定不引入（Q-101），未创建。
  - 涉及文件：`apps/server/test/registration.test.ts`（新增）、`apps/server/package.json`、`apps/web/playwright.config.ts`（未创建：用户决定不引入 Playwright）、`apps/web/e2e/registration.spec.ts`（未创建：用户决定不引入 Playwright）、`apps/web/package.json`、`turbo.json`
  - 接口与数据变化：无
  - 验证方式：`pnpm --filter server test` 运行通过。
  - 完成证据：服务端 `node:test` + `tsx`（`apps/server/test/`、`test` 脚本、turbo `test` 任务）6/6 通过；Web 端到端按用户决定不引入

## 差异与待确认项

- Q-101 【已确认：不引入】用户决定不引入 Playwright。Web 端到端验收改用本机 Chrome + CDP 脚本实测（无新增依赖），结果见各目录 task.md。
- Q-102 【已确认：不测试】用户决定 Native 不做模拟器 UI 测试，Native 改动仅以 `check-types` 验证。
- Q-103 【已解决】brew 因 Command Line Tools 过旧无法安装 PostgreSQL；按用户要求改为项目内运行：`pnpm db:start` 启动 `embedded-postgres@17.11.0-beta.19`（`packages/db` devDependency），端口与凭据取自 `DATABASE_URL`，数据在 `packages/db/.local-postgres`（已 gitignore）。
- Q-104 【已解决】`auth:generate` 成功，但需先运行 `pnpm db:generate`（CLI 加载 `packages/db` 时依赖已生成的 Prisma Client）。
- Q-105 【待确认】`pnpm check` 在改动前即失败：根 `biome.json` 的 `nursery.useTailwindSortedClasses` 在 Biome 2.5.15 中不存在，且 `apps/fumadocs/biome.json` 是嵌套 root 配置；修正配置后基线仍有 446 个错误（主要是配置要求 tab 缩进而全仓库为 2 空格）。是否修复配置并全仓库格式化需用户决定，本目录不擅自处理。
- Q-106 【待确认】`pnpm db:push`（经 turbo）因任务为 interactive 且无 TUI 报错，需在 `packages/db` 直接运行 `pnpm exec prisma db push`。

## 与原设计的差异

- DES-008：服务端测试脚本为 `varlock run -- tsx --test --test-concurrency=1 test/*.test.ts`，测试文件名为 `registration.test.ts`，公共工具在 `apps/server/test/helpers.ts`（新增）；不新增 Web 端到端测试（Q-101）。
- DES-003：`hooks.before` 在端点校验前执行，返回的 `context.body` 会与原请求体合并（见 `better-auth/dist/api/dispatch.mjs`），因此覆盖 `email` 有效。
- [02-login DES-001](../02-login/design.md) 的 `disabledPaths` 不在本目录写入：Codex CR 指出若先禁用 `/sign-in/email` 而登录表单仍调用它，两端登录全部失败，因此与 02-login 的表单迁移放在同一改动中。
