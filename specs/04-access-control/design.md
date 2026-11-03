# 04 访问控制 — 设计

## 技术背景

- 技术栈与分层同 [01-registration 技术背景](../01-registration/design.md#技术背景)。来源：`AGENTS.md`。
- Next.js 16 App Router；`apps/web/AGENTS.md` 提示该版本存在破坏性变更，需先查阅 `node_modules/next/dist/docs/`。来源：`apps/web/AGENTS.md`。
- 现有实现：`apps/web/src/app/dashboard/page.tsx` 已在服务端组件中用 `authClient.getSession({ fetchOptions: { headers: await headers() } })` 判断会话并 `redirect("/login")`；`apps/web/src/app/login/page.tsx` 为客户端组件，无会话判断。来源：源码。
- 后端：`packages/api/src/index.ts` 的 `protectedProcedure` 在无会话时抛出 `UNAUTHORIZED`；`apps/server/src/context.ts` 通过 `auth.api.getSession` 解析会话。来源：源码。
- Native：`apps/native/app/(drawer)/index.tsx` 已按 `session?.user` 切换内容。来源：源码。
- 测试：复用 [01-registration DES-008](../01-registration/design.md)。

## 设计项

- [x] DES-001 `/login` 已登录重定向（关联 REQ-001.02）
  - 实现方案：将 `login/page.tsx` 改为服务端组件，复用 Dashboard 的会话获取方式，已登录 `redirect("/dashboard")`；原客户端切换逻辑移入新文件 `login/login-forms.tsx`（`"use client"`），保留 [02-login DES-002](../02-login/design.md) 的默认登录表单。
  - 涉及文件：`apps/web/src/app/login/page.tsx`、`apps/web/src/app/login/login-forms.tsx`（新增）
  - 接口与数据变化：无
  - 验证方式：Web 端到端测试。
  - 完成证据：`login/page.tsx` 服务端判断会话；浏览器实测：本机 Chrome（headless，CDP 驱动，无新增依赖）对 `pnpm db:start` 的项目内数据库跑通 26/26 项检查（2026-11-03）；脚本位于会话临时目录，未入库：已登录访问 `/login` 跳转 `/dashboard`

- [x] DES-002 `/dashboard` 未登录重定向（关联 REQ-001.01）
  - 实现方案：沿用现有逻辑；仅确认 `getSession` 在后端不可达或返回错误时也重定向到 `/login`（`throw: true` 时异常会导致 500，改为捕获后视为未登录）。
  - 涉及文件：`apps/web/src/app/dashboard/page.tsx`
  - 接口与数据变化：无
  - 验证方式：Web 端到端测试。
  - 完成证据：`get-server-session.ts` 捕获异常视为未登录；浏览器实测：本机 Chrome（headless，CDP 驱动，无新增依赖）对 `pnpm db:start` 的项目内数据库跑通 26/26 项检查（2026-11-03）；脚本位于会话临时目录，未入库：退出后访问 `/dashboard` 跳转 `/login`

- [ ] DES-003 Native 首页按会话切换（关联 REQ-002.01）
  - 实现方案：沿用现有 `session?.user` 判断，不改代码；随 [03-logout-and-status DES-003](../03-logout-and-status/design.md) 一并验证。
  - 涉及文件：`apps/native/app/(drawer)/index.tsx`（无改动）
  - 接口与数据变化：无
  - 验证方式：模拟器 UI 测试（[01-registration Q-102](../01-registration/design.md#差异与待确认项)）。
  - 完成证据：无代码改动；按用户决定不做 Native UI 测试，故未勾选

- [x] DES-004 后端受保护接口（关联 REQ-003）
  - 实现方案：沿用现有 `protectedProcedure`，不改代码；补充集成测试。
  - 涉及文件：`apps/server/test/access.test.ts`（新增）
  - 接口与数据变化：无
  - 验证方式：服务端集成测试。
  - 完成证据：access.test.ts 2/2 通过（401 + UNAUTHORIZED；登录后返回当前用户）
