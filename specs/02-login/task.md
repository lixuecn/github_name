# 02 登录 — 任务

- [x] TASK-001 禁用邮箱登录端点
  - 关联：REQ-002.01、DES-001
  - 工作：`createAuth()` 增加 `disabledPaths`
  - 涉及文件：`packages/auth/src/index.ts`
  - 前置依赖：[01-registration TASK-001](../01-registration/task.md)
  - 验证：TASK-004

- [x] TASK-002 Web 登录表单
  - 关联：REQ-001、REQ-003、DES-002
  - 工作：改写 `SignInForm`；`/login` 默认显示登录表单
  - 涉及文件：`apps/web/src/components/sign-in-form.tsx`、`apps/web/src/app/login/page.tsx`
  - 前置依赖：[01-registration TASK-003](../01-registration/task.md)
  - 验证：TASK-005

- [x] TASK-003 Native 登录表单
  - 关联：REQ-001、REQ-003.01、DES-003
  - 工作：改写 `SignIn` 组件
  - 涉及文件：`apps/native/components/sign-in.tsx`
  - 前置依赖：[01-registration TASK-003](../01-registration/task.md)
  - 验证：`pnpm check-types`；模拟器 UI 测试

- [x] TASK-004 服务端集成测试
  - 关联：REQ-001.02、REQ-001.03、REQ-002.01、DES-001
  - 工作：在 `apps/server/test/` 新增登录用例：大小写不敏感登录成功、错误密码与不存在用户返回相同错误码、`/sign-in/email` 返回 404
  - 涉及文件：`apps/server/test/login.test.ts`（新增）
  - 前置依赖：TASK-001、[01-registration TASK-006](../01-registration/task.md)
  - 验证：`pnpm --filter server test` 通过

- [x] TASK-005 Web 登录端到端测试
  - 关联：REQ-001、REQ-003、DES-002
  - 工作：新增 `apps/web/e2e/login.spec.ts`（未创建）：表单校验、登录成功跳转、错误提示、登录/注册切换
  - 涉及文件：`apps/web/e2e/login.spec.ts`（未创建：用户决定不引入 Playwright）
  - 前置依赖：TASK-002、[01-registration TASK-007](../01-registration/task.md)
  - 验证：`pnpm --filter web test:e2e` 通过

- [ ] TASK-006 质量检查
  - 关联：全部
  - 工作：`pnpm check-types`、`pnpm check`
  - 前置依赖：TASK-001 至 TASK-005
  - 验证：两条命令均通过

## 进度记录（2026-11-03）

- 改动文件：`packages/auth/src/index.ts`（`disabledPaths`、`immutableUsername`）、`apps/web/src/components/sign-in-form.tsx`、`apps/web/src/app/login/page.tsx`、`apps/native/components/sign-in.tsx`、`apps/server/test/login.test.ts`（新增）、`apps/server/test/helpers.ts`（非 JSON 响应兼容）、`apps/server/test/registration.test.ts`（新增改名用例）
- 测试结果：`pnpm --filter server test` 10/10 通过（含本目录 3 条登录用例）；`pnpm check-types` 7/7 通过。
- TASK-002：仅类型检查与接口测试验证，未做端到端验证（[01 Q-101](../01-registration/design.md#差异与待确认项)）。TASK-003：按用户决定 Native 不做 UI 测试。
- TASK-005 未完成：未引入 Playwright。TASK-006 未完成：`pnpm check` 基线失败（[01 Q-105](../01-registration/design.md#差异与待确认项)）。
- Codex CR：1 条 P2「`/update-user` 改名后占位邮箱不一致，导致用户名无法注册」——品审成立；修改用户名属 01 非目标，修复为 `username({ immutableUsername: true })`，并在 registration.test.ts 增加「does not allow changing the username」用例。
- 并行说明：TASK-002 / TASK-003 可并行，但各为单文件小改动，未开启 agents 群组，由 Claude 顺序完成。
- TASK-005 更新：浏览器实测：本机 Chrome（headless，CDP 驱动，无新增依赖）对 `pnpm db:start` 的项目内数据库跑通 26/26 项检查（2026-11-03）；脚本位于会话临时目录，未入库。
