# 03 退出登录与登录状态展示 — 设计

## 技术背景

- 技术栈与分层同 [01-registration 技术背景](../01-registration/design.md#技术背景)。来源：`AGENTS.md`。
- 会话：Web 使用 httpOnly cookie（`sameSite: "none"`、`secure`），Native 使用 `expoClient` + `expo-secure-store`。来源：`packages/auth/src/index.ts`、`apps/native/lib/auth-client.ts`、`AGENTS.md`「架构与数据流」。
- 可复用模块：
  - Web：`apps/web/src/components/header.tsx`、`apps/web/src/components/user-menu.tsx`（`DropdownMenu`、`Skeleton`）、`apps/web/src/app/dashboard/page.tsx`、`apps/web/src/app/dashboard/dashboard.tsx`、`useTRPC()`。来源：源码。
  - Native：`apps/native/app/(drawer)/index.tsx`（已登录卡片）、`queryClient`。来源：源码。
  - API：`packages/api/src/routers/index.ts` 的 `privateData`（`protectedProcedure`）。来源：源码。
- 测试：复用 [01-registration DES-008](../01-registration/design.md)。

## 设计项

- [x] DES-001 Web 页头与用户菜单（关联 REQ-001、REQ-003.01、REQ-003.03）
  - 实现方案：`header.tsx` 导航文案改为「首页」「控制台」；`user-menu.tsx`：未登录按钮「登录」，菜单标题「我的账户」，删除邮箱项，「退出登录」调用 `authClient.signOut`，成功 `router.push("/")` 并 `router.refresh()`，失败 `toast.error("退出失败，请稍后再试")`。
  - 涉及文件：`apps/web/src/components/header.tsx`、`apps/web/src/components/user-menu.tsx`
  - 接口与数据变化：无
  - 验证方式：Web 端到端测试。
  - 完成证据：header 中文导航；user-menu 去邮箱、「我的账户」「退出登录」、退出后 `router.refresh()`、失败 toast；`check-types` 通过

- [x] DES-002 Dashboard 欢迎语与受保护数据（关联 REQ-002）
  - 实现方案：`dashboard/page.tsx` 标题「控制台」、欢迎语「欢迎，{name}」；`dashboard.tsx` 展示 `privateData.data?.message`；`privateData` 返回消息改为中文「这是受保护的数据」。
  - 涉及文件：`apps/web/src/app/dashboard/page.tsx`、`apps/web/src/app/dashboard/dashboard.tsx`、`packages/api/src/routers/index.ts`
  - 接口与数据变化：`privateData.message` 文案变化（结构不变）。
  - 验证方式：Web 端到端测试、服务端集成测试。
  - 完成证据：Dashboard「欢迎，{name}」；`privateData.message` 为「这是受保护的数据」；session.test.ts 验证

- [x] DES-003 Native 登录状态与退出（关联 REQ-003.02、REQ-003.03、Q-001）
  - 实现方案：首页已登录卡片显示「欢迎，{name}」，删除邮箱行；按钮「退出登录」：`await authClient.signOut()`，失败 toast「退出失败，请稍后再试」，成功后 `queryClient.invalidateQueries()`。同页其他英文文案改中文。
  - 涉及文件：`apps/native/app/(drawer)/index.tsx`
  - 接口与数据变化：无
  - 验证方式：`pnpm check-types`；模拟器 UI 测试（[01-registration Q-102](../01-registration/design.md#差异与待确认项)）。
  - 完成证据：Native 已登录卡片仅显示「欢迎，{name}」，`signOut` 失败 toast；`check-types` 通过；按用户决定不做 UI 测试

- [x] DES-004 会话持久化验证（关联 REQ-004）
  - 实现方案：沿用现有 cookie / SecureStore 机制，不改代码；通过测试验证。
  - 涉及文件：`apps/server/test/session.test.ts`（新增；原计划的 Web 端到端测试未引入）
  - 接口与数据变化：无
  - 验证方式：Web 端到端测试刷新后仍登录；Native 重启验证依赖模拟器。
  - 完成证据：session.test.ts 验证服务端会话持续有效；浏览器实测：本机 Chrome（headless，CDP 驱动，无新增依赖）对 `pnpm db:start` 的项目内数据库跑通 26/26 项检查（2026-11-03）；脚本位于会话临时目录，未入库：刷新 `/dashboard` 仍保持登录。Native 重启按用户决定未测试
