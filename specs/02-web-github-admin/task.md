# 02 Web 端 GitHub 人员管理 — 任务

前置：[01 TASK-005、TASK-006](../01-github-api/task.md)（接口与服务装配）完成。
环境：Node 22、本机 Chrome、embedded-postgres、GitHub API 可访问，无阻塞。

- [x] TASK-001 新增共享 UI 组件
  - 关联：REQ-004、REQ-005、REQ-007；DES-001
  - 工作：用 shadcn CLI 向 `packages/ui` 添加 dialog、alert-dialog、table、badge（排序改用原生 select，见 DES-001）
  - 文件：`packages/ui/src/components/*.tsx`、`packages/ui/package.json`
  - 依赖：无
  - 验证：`pnpm check-types`

- [x] TASK-002 导航入口与全局错误处理
  - 关联：REQ-001、REQ-002.03；DES-002
  - 工作：header 增加链接；QueryCache 支持 `meta.silent`，按钮文案改「重试」
  - 文件：`apps/web/src/components/header.tsx`、`apps/web/src/utils/trpc.ts`
  - 依赖：无
  - 验证：E2E

- [x] TASK-003 格式化工具
  - 关联：REQ-002.02、REQ-004.01；DES-003
  - 工作：实现 `formatCount`、`formatRelativeTime`、`formatDate`、`toSafeHttpUrl`
  - 文件：`apps/web/src/lib/format.ts`
  - 依赖：无
  - 验证：类型检查、E2E 显示值

- [x] TASK-004 页面与搜索区
  - 关联：REQ-001、REQ-002、REQ-003、REQ-008；DES-004
  - 工作：`/github` 页面、搜索表单、结果卡片、加入系统
  - 文件：`apps/web/src/app/github/page.tsx`、`_components/github-admin.tsx`、`github-search.tsx`、`github-profile-card.tsx`
  - 依赖：TASK-001 – TASK-003；[01 TASK-005](../01-github-api/task.md)
  - 验证：E2E 搜索与加入场景

- [x] TASK-005 人员列表区
  - 关联：REQ-004；DES-005
  - 工作：过滤、排序、游标分页、表格 / 卡片布局、各状态
  - 文件：`_components/github-list.tsx`、`github-row-actions.tsx`、`apps/web/src/hooks/use-debounced-value.ts`
  - 依赖：TASK-001、TASK-003、TASK-004（挂载于 `github-admin.tsx`）
  - 验证：E2E 列表场景

- [x] TASK-006 编辑、同步、删除
  - 关联：REQ-005、REQ-006、REQ-007；DES-006
  - 工作：编辑弹窗、同步操作、删除确认
  - 文件：`_components/edit-profile-dialog.tsx`、`delete-profile-dialog.tsx`、`github-row-actions.tsx`
  - 依赖：TASK-005
  - 验证：E2E 编辑 / 同步 / 删除场景

- [x] TASK-007 端到端测试
  - 关联：REQ-001 – REQ-008；DES-007
  - 工作：编写并运行 Chrome CDP 脚本覆盖全部验收条件
  - 依赖：TASK-001 – TASK-006
  - 验证：全部断言通过；`pnpm check-types` 通过

- [x] TASK-008 Codex CR、品审与修复
  - 关联：全部；DES-001 – DES-007
  - 工作：运行 Codex review，核实并修复确认的问题，未修复项注明理由
  - 依赖：TASK-001 – TASK-007
  - 验证：修复后重新运行 TASK-007

## 完成记录（2026-11-08）

- 改动文件：`packages/ui/src/components/{dialog,alert-dialog,table,badge}.tsx`（新增）、`apps/web/src/components/header.tsx`、`apps/web/src/utils/trpc.ts`、`apps/web/src/lib/{format,trpc-error}.ts`（新增）、`apps/web/src/hooks/use-debounced-value.ts`（新增）、`apps/web/src/app/github/page.tsx` 与 `_components/*`（新增）。
- 测试：Chrome headless + CDP 端到端 21/21 通过（真实 GitHub API + 本地 PostgreSQL；25 条分页数据直接写库，测试结束只清理自身数据）；`pnpm check-types` 6/6；服务端测试 29/29。
- 环境说明：本机访问 GitHub API 不稳定（单次 5–12s，偶发 504 / 10s 超时），E2E 对依赖 GitHub 的操作最多重试 3 次（等同用户再次点击）；应用对超时 / 504 正确显示「查询失败，请稍后重试」。
- 测试中发现并修复：①同一用户名失败后再次提交不发请求（改为 refetch）；②切换排序后再切回会恢复旧页码（渲染期重置分页状态）。
- Codex CR（TASK-008）：2 条 P2，均核实成立并修复——①后台刷新（窗口聚焦）时卸载结果卡片导致备注草稿丢失：有数据时只禁用按钮、不显示骨架；②删除后搜索卡片仍显示「已添加」：删除成功同时失效 `github.search`。均有 E2E 回归步骤。无未修复项。
- 并行说明：TASK-001 – TASK-003 互不依赖，但均为小改动且仓库存在大量未提交改动（worktree 基线不一致），按依赖顺序串行开发。
