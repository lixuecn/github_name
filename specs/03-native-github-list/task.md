# 03 Android App GitHub 人员展示 — 任务

前置：[01 TASK-005](../01-github-api/task.md)（`github.list` 接口）完成。
环境：已安装 Android Studio / SDK 与模拟器（`Medium_Phone_API_37.0`，Android 17），App 测试在模拟器上进行，不使用 Expo Web。

- [x] TASK-001 导航重构
  - 关联：REQ-001；DES-001
  - 工作：删除 Drawer / 示例 Tabs / Modal，新建 `(tabs)` 布局，调整根布局与 not-found
  - 文件：`apps/native/app/_layout.tsx`、`apps/native/app/(tabs)/_layout.tsx`、`apps/native/app/+not-found.tsx`、删除 `apps/native/app/(drawer)/**`、`apps/native/app/modal.tsx`
  - 依赖：无
  - 验证：类型检查；模拟器上启动进入「人员」Tab

- [x] TASK-002 格式化工具与依赖
  - 关联：REQ-002.04；DES-002、DES-003
  - 工作：实现 `formatCount`；`expo install expo-image`
  - 文件：`apps/native/lib/format.ts`、`apps/native/package.json`、`pnpm-lock.yaml`
  - 依赖：无
  - 验证：类型检查

- [x] TASK-003 人员卡片与骨架
  - 关联：REQ-002.04、REQ-002.05、REQ-004；DES-003
  - 工作：实现卡片（头像、文本截断、统计、标签、备注、点击打开主页）与骨架
  - 文件：`apps/native/components/github/profile-card.tsx`、`apps/native/components/github/list-state.tsx`（骨架与状态组件合并于此）
  - 依赖：TASK-002
  - 验证：UI 测试

- [x] TASK-004 人员列表页
  - 关联：REQ-002；DES-004
  - 工作：标题与总数、搜索防抖、排序 Chip、无限加载、下拉刷新、各状态
  - 文件：`apps/native/app/(tabs)/index.tsx`、`apps/native/components/github/list-state.tsx`、`apps/native/hooks/use-debounced-value.ts`
  - 依赖：TASK-001、TASK-003；[01 TASK-005](../01-github-api/task.md)
  - 验证：UI 测试

- [x] TASK-005 设置页
  - 关联：REQ-003；DES-005
  - 工作：主题浅色 / 深色二选一（默认浅色、不跟随系统）、连接状态、版本号
  - 文件：`apps/native/app/(tabs)/settings.tsx`、`apps/native/contexts/app-theme-context.tsx`
  - 依赖：TASK-001
  - 验证：UI 测试

- [x] TASK-006 ~~Expo Web UI 测试（降级）~~ 已取消：本机已有 Android 模拟器，改由 TASK-007 验收，不再使用 Expo Web
  - 关联：REQ-001 – REQ-004；DES-006
  - 工作：Chrome CDP 脚本覆盖全部验收条件
  - 依赖：TASK-001 – TASK-005
  - 验证：断言全部通过；`pnpm --filter native check-types` 通过

- [x] TASK-007 Android 模拟器 UI 验收
  - 关联：REQ-001 – REQ-004；DES-006
  - 工作：在 Android 10+ 设备上运行 App，按验收条件逐项检查
  - 依赖：TASK-001 – TASK-005
  - 验证：Android 上全部验收条件通过

- [x] TASK-008 Codex CR、品审与修复
  - 关联：全部；DES-001 – DES-006
  - 工作：运行 Codex review，核实并修复确认的问题，未修复项注明理由
  - 依赖：TASK-001 – TASK-006
  - 验证：修复后重新运行 TASK-006

## 完成记录（2026-11-08）

- 改动文件：删除 `apps/native/app/(drawer)/**`、`apps/native/app/modal.tsx`、`apps/native/components/theme-toggle.tsx`（无引用）；修改 `apps/native/app/_layout.tsx`、`apps/native/app/+not-found.tsx`（中文文案）、`apps/native/contexts/app-theme-context.tsx`（启动时固定浅色，不跟随系统）、`apps/native/package.json`（`expo install expo-image`）；新增 `apps/native/app/(tabs)/{_layout,index,settings}.tsx`、`apps/native/components/github/{profile-card,list-state,types}.tsx|ts`、`apps/native/hooks/use-debounced-value.ts`、`apps/native/lib/format.ts`。
- 测试（TASK-006，已取消，仅作历史记录）：曾用 Expo Web + Chrome headless CDP 15/15 通过（412×915 移动视口；覆盖导航、总数、卡片字段与空字段隐藏、数值缩写、无限加载与停止、点击打开主页及 44×44 触控区域、搜索 / 清空 / 无匹配、排序、加载失败重试、加载更多失败重试、设置页连接状态 / 版本 / 主题切换、深色模式对比度 19.74:1）；`pnpm --filter native check-types` 通过；浅色 / 深色截图人工检查通过。
- 测试说明：服务端 CORS 仅允许 Web 源，原生 App 不受 CORS 约束，Expo Web 替身测试以 `--disable-web-security` 运行；下拉刷新（RefreshControl）在 Web 上不可模拟，归入 TASK-007。
- 测试中发现并修复：单选 Chip 的选中态改用 `checked` 并显式传 `aria-checked`（HeroUI Chip 不透传 `accessibilityState`，读屏无法识别选中项）。
- Codex CR（TASK-008）：2 条 P2，均核实成立并修复——①加载下一页失败时已有数据导致错误与重试不可见、分页静默卡住：列表底部显示「加载更多失败」+「重试」，并在刷新失败时于顶部提示「刷新失败，请下拉重试」；②健康检查失败后仍沿用缓存的「已连接」：先判断 `isError`。均有回归步骤。无未修复项。
- TASK-007（Android 模拟器，Android 17）：完整验收 15/16 通过（下拉刷新、Tab、卡片字段与空字段隐藏、触控区域、搜索、上拉加载到末页、Chrome 打开主页并精确比对网址、排序、断网重试、加载更多失败重试、设置页连接状态与版本、深色对比度 19.74:1、后端不可达显示未连接）；唯一失败项「跟随系统」已按 2026-11-08 需求变更删除（默认浅色、不跟随系统），主题专项复测 5/5 通过。空数据提示于数据清空后补测通过。全部验收条件在 Android 模拟器上通过。
- 并行说明：TASK-001 后 TASK-004 与 TASK-005 互不依赖，但 worktree 基于 HEAD 缺少前两个目录的未提交改动，按依赖顺序串行开发。
