# 02 登录 — 设计

## 技术背景

- 技术栈与分层同 [01-registration 技术背景](../01-registration/design.md#技术背景)：Better Auth 1.7.12、Hono、Next.js 16、Expo 58。来源：`AGENTS.md`、`pnpm-workspace.yaml`。
- 认证配置集中于 `packages/auth/src/index.ts` 的 `createAuth()`。来源：`AGENTS.md`「架构与数据流」。
- 可复用模块：
  - [01-registration DES-005](../01-registration/design.md) 的 `usernameClient()` 与 `getAuthErrorMessage()`。
  - Web：`apps/web/src/components/sign-in-form.tsx`、`apps/web/src/app/login/page.tsx`。来源：源码。
  - Native：`apps/native/components/sign-in.tsx`。来源：源码。
- Better Auth 配置项 `disabledPaths` 可禁用指定端点；`signIn.username` 端点为 `/sign-in/username`，错误码 `INVALID_USERNAME_OR_PASSWORD`。来源：Better Auth 文档 `/docs/plugins/username`。
- 测试：复用 [01-registration DES-008](../01-registration/design.md) 的服务端 `node:test`（用户决定不引入 Playwright）。

## 设计项

- [x] DES-001 禁用邮箱登录端点（关联 REQ-002.01）
  - 实现方案：`createAuth()` 增加 `disabledPaths: ["/sign-in/email"]`。
  - 涉及文件：`packages/auth/src/index.ts`
  - 接口与数据变化：`POST /api/auth/sign-in/email` 返回 404。
  - 验证方式：服务端集成测试。
  - 完成证据：`disabledPaths: ["/sign-in/email"]`；login.test.ts「disables email sign-in」返回 404 且无会话 cookie

- [x] DES-002 Web 登录表单（关联 REQ-001、REQ-003）
  - 实现方案：改写 `SignInForm`：字段 `username`、`password`；调用 `authClient.signIn.username`；成功 `router.push("/dashboard")` + `toast.success("登录成功")`；失败 `getAuthErrorMessage(error, "登录失败，请稍后再试")`；按钮「登录中…」；中文文案。`/login` 页面默认显示登录表单（Q-001）。
  - 涉及文件：`apps/web/src/components/sign-in-form.tsx`、`apps/web/src/app/login/page.tsx`（切换逻辑；页面的会话跳转见 [04-access-control](../04-access-control/design.md)）
  - 接口与数据变化：无
  - 验证方式：Web 端到端测试。
  - 完成证据：`sign-in-form.tsx` 改为 `signIn.username`，`/login` 默认登录表单；浏览器实测：本机 Chrome（headless，CDP 驱动，无新增依赖）对 `pnpm db:start` 的项目内数据库跑通 26/26 项检查（2026-11-03）；脚本位于会话临时目录，未入库：空表单校验提示、登录/注册切换、错误密码提示「用户名或密码错误」、小写用户名登录成功跳转并提示

- [x] DES-003 Native 登录表单（关联 REQ-001、REQ-003.01）
  - 实现方案：改写 `SignIn` 组件为用户名 + 密码，调用 `authClient.signIn.username`，`autoCapitalize="none"`，中文提示。
  - 涉及文件：`apps/native/components/sign-in.tsx`
  - 接口与数据变化：无
  - 验证方式：`pnpm check-types`；模拟器 UI 测试（见 [01-registration Q-102](../01-registration/design.md#差异与待确认项)）。
  - 完成证据：`apps/native/components/sign-in.tsx` 改为 `signIn.username`；`check-types` 通过；按用户决定不做 UI 测试
