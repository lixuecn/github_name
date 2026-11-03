# 03 退出登录与登录状态展示 — 任务

- [x] TASK-001 Web 页头与用户菜单
  - 关联：REQ-001、REQ-003.01、REQ-003.03、DES-001
  - 工作：中文导航；用户菜单去邮箱、中文、退出失败提示
  - 涉及文件：`apps/web/src/components/header.tsx`、`apps/web/src/components/user-menu.tsx`
  - 前置依赖：[02-login TASK-002](../02-login/task.md)
  - 验证：TASK-004

- [x] TASK-002 Dashboard 展示
  - 关联：REQ-002、DES-002
  - 工作：中文欢迎语；`privateData` 中文消息
  - 涉及文件：`apps/web/src/app/dashboard/page.tsx`、`apps/web/src/app/dashboard/dashboard.tsx`、`packages/api/src/routers/index.ts`
  - 前置依赖：无
  - 验证：TASK-004

- [x] TASK-003 Native 登录状态与退出
  - 关联：REQ-003.02、REQ-003.03、DES-003
  - 工作：改写首页已登录卡片与退出逻辑，中文文案
  - 涉及文件：`apps/native/app/(drawer)/index.tsx`
  - 前置依赖：[02-login TASK-003](../02-login/task.md)
  - 验证：`pnpm check-types`；模拟器 UI 测试

- [x] TASK-004 Web 端到端测试
  - 关联：REQ-001、REQ-002、REQ-003.01、REQ-004.01、DES-001、DES-002、DES-004
  - 工作：新增 `apps/web/e2e/session.spec.ts`（未创建）：登录前后页头状态、菜单无邮箱、Dashboard 欢迎语与数据、刷新保持登录、退出后恢复未登录
  - 涉及文件：`apps/web/e2e/session.spec.ts`（未创建：用户决定不引入 Playwright）
  - 前置依赖：TASK-001、TASK-002、[01-registration TASK-007](../01-registration/task.md)
  - 验证：`pnpm --filter web test:e2e` 通过

- [ ] TASK-005 质量检查
  - 关联：全部
  - 工作：`pnpm check-types`、`pnpm check`
  - 前置依赖：TASK-001 至 TASK-004
  - 验证：两条命令均通过

## 进度记录（2026-11-03）

- 改动文件：`apps/web/src/components/header.tsx`、`apps/web/src/components/user-menu.tsx`、`apps/web/src/app/dashboard/page.tsx`、`apps/web/src/app/dashboard/dashboard.tsx`、`packages/api/src/routers/index.ts`、`apps/native/app/(drawer)/index.tsx`、`apps/server/test/session.test.ts`（新增）
- 测试结果：`pnpm --filter server test` 13/13 通过（本目录 3 条：会话 cookie 持续有效、`privateData` 中文消息与当前用户、退出后会话失效）；`pnpm check-types` 7/7 通过。
- TASK-001 / TASK-002：页面渲染部分仅类型检查，未做端到端验证；接口行为由 session.test.ts 覆盖。TASK-003：按用户决定 Native 不做 UI 测试。
- TASK-004 未完成：未引入 Playwright（原计划的 `apps/web/e2e/session.spec.ts` 未创建）。TASK-005 未完成：`pnpm check` 基线失败。
- Codex CR：1 条 P2「直连 Hono 的请求没有 `x-forwarded-for`，所有客户端共用一个频率限制桶，测试因伪造随机 IP 掩盖了问题」——品审成立，属 [01 DES-004](../01-registration/design.md)。修复：`apps/server/src/index.ts` 将 socket 对端地址追加到 `x-forwarded-for`；`createAuth()` 设置 `advanced.ipAddress.trustedProxies` 为回环地址，从右往左取第一个非可信地址，远程客户端伪造的值被忽略。registration.test.ts 增加「其他客户端不受影响」断言。
- TASK-004 更新：浏览器实测：本机 Chrome（headless，CDP 驱动，无新增依赖）对 `pnpm db:start` 的项目内数据库跑通 26/26 项检查（2026-11-03）；脚本位于会话临时目录，未入库。覆盖：页头用户名、菜单「我的账户」且无邮箱、Dashboard 欢迎语与受保护数据、刷新保持登录、退出后跳转首页且页头恢复「登录」。
