# 04 访问控制 — 任务

- [x] TASK-001 `/login` 已登录重定向
  - 关联：REQ-001.02、DES-001
  - 工作：`login/page.tsx` 改为服务端组件并判断会话；新增 `login/login-forms.tsx`
  - 涉及文件：`apps/web/src/app/login/page.tsx`、`apps/web/src/app/login/login-forms.tsx`
  - 前置依赖：[02-login TASK-002](../02-login/task.md)
  - 验证：TASK-004

- [x] TASK-002 `/dashboard` 会话异常视为未登录
  - 关联：REQ-001.01、DES-002
  - 工作：捕获 `getSession` 异常并重定向
  - 涉及文件：`apps/web/src/app/dashboard/page.tsx`
  - 前置依赖：[03-logout-and-status TASK-002](../03-logout-and-status/task.md)
  - 验证：TASK-004

- [x] TASK-003 服务端集成测试
  - 关联：REQ-003、DES-004
  - 工作：新增 `apps/server/test/access.test.ts`：无 cookie 调用 `privateData` 返回 401；登录后返回 200 与当前用户
  - 涉及文件：`apps/server/test/access.test.ts`（新增）
  - 前置依赖：[01-registration TASK-006](../01-registration/task.md)
  - 验证：`pnpm --filter server test` 通过

- [x] TASK-004 Web 端到端测试
  - 关联：REQ-001、DES-001、DES-002
  - 工作：新增 `apps/web/e2e/access.spec.ts`（未创建）：未登录访问 `/dashboard` 重定向、登录后访问 `/login` 重定向、退出后访问 `/dashboard` 重定向
  - 涉及文件：`apps/web/e2e/access.spec.ts`（未创建：用户决定不引入 Playwright）
  - 前置依赖：TASK-001、TASK-002、[01-registration TASK-007](../01-registration/task.md)
  - 验证：`pnpm --filter web test:e2e` 通过

- [ ] TASK-005 Native 首页切换验证
  - 关联：REQ-002.01、DES-003
  - 工作：模拟器上验证登录前后首页内容
  - 涉及文件：无
  - 前置依赖：[03-logout-and-status TASK-003](../03-logout-and-status/task.md)
  - 验证：模拟器 UI 测试

- [ ] TASK-006 质量检查
  - 关联：全部
  - 工作：`pnpm check-types`、`pnpm check`
  - 前置依赖：TASK-001 至 TASK-005
  - 验证：两条命令均通过

## 进度记录（2026-11-03）

- 改动文件：`apps/web/src/app/login/page.tsx`（改为服务端组件）、`apps/web/src/app/login/login-forms.tsx`（新增）、`apps/web/src/app/dashboard/page.tsx`、`apps/web/src/lib/get-server-session.ts`（新增，两页共用的会话获取，异常视为未登录）、`apps/server/test/access.test.ts`（新增）
- 测试结果：`pnpm --filter server test` 15/15 通过（本目录 2 条：匿名调用 `privateData` 返回 401 + `UNAUTHORIZED`、登录后返回当前用户）；`pnpm check-types` 7/7 通过。
- TASK-004 未勾选：未引入 Playwright，无自动化端到端测试。已启动 server + `next dev` 用 curl 手动验证：未登录 `/dashboard` → 307 `/login`；已登录 `/dashboard` 200 且含「欢迎，{用户名}」；已登录 `/login` → 307 `/dashboard`；退出后 `/dashboard` → 307 `/login`。
- TASK-005 未勾选：用户决定 Native 不做 UI 测试。TASK-006 未勾选：`pnpm check` 基线失败。
- Codex CR：无可执行问题。
- 与设计差异：新增 `get-server-session.ts`，避免两页重复会话获取逻辑；按 Next.js 16 文档，`redirect()` 在 `try/catch` 之外调用。
- TASK-004 更新：浏览器实测：本机 Chrome（headless，CDP 驱动，无新增依赖）对 `pnpm db:start` 的项目内数据库跑通 26/26 项检查（2026-11-03）；脚本位于会话临时目录，未入库；另有 curl 验证见上。
