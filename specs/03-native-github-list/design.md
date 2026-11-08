# 03 Android App GitHub 人员展示 — 设计

## 技术背景

| 项 | 内容 | 来源 |
| --- | --- | --- |
| 框架 | Expo 58 + Expo Router（`typedRoutes`、`reactCompiler`），React Native 0.88 | `apps/native/package.json`、`apps/native/app.json` |
| 现有路由 | `app/_layout.tsx`（Stack + Providers）、`app/(drawer)/*`（Drawer + 示例 Tabs）、`app/modal.tsx`、`app/+not-found.tsx` | `apps/native/app/` |
| UI | HeroUI Native（`Card`、`Chip`、`SearchField`、`Avatar`、`Skeleton`、`Button`、`RadioGroup`、`Spinner` 等）+ Uniwind（Tailwind for RN），`useThemeColor` 取主题色 | `apps/native/node_modules/heroui-native/lib/typescript/src/components/`、`AGENTS.md` |
| 主题 | `contexts/app-theme-context.tsx` 封装 `Uniwind.setTheme`（`uniwind` 支持 `"light" | "dark" | "system"`，本项目只用前两者） | `apps/native/contexts/app-theme-context.tsx`、`uniwind` 类型声明 |
| 可复用组件 | `components/container.tsx`（安全区 + 背景）、`components/theme-toggle.tsx` | `apps/native/components/` |
| 数据 | `utils/trpc.ts` 导出 `trpc`（`createTRPCOptionsProxy`）与 `queryClient`；`@trpc/tanstack-react-query` 支持 `infiniteQueryOptions` | `apps/native/utils/trpc.ts` |
| 外链 | 已安装 `expo-web-browser`、`expo-linking` | `apps/native/package.json` |
| 版本号 | `expo-constants` 的 `Constants.expoConfig?.version` | `apps/native/package.json`、`app.json` |
| 后端接口 | `github.list({ keyword, sort, cursor, limit })` 返回 `items/total/nextCursor`；共享常量 `@my-better-t-app/api/shared/github` | [01 design](../01-github-api/design.md) |
| 编码规范 | 函数组件、hooks 顶层、列表用 `key`、不在组件内定义组件、语义化与无障碍 | `AGENTS.md` |
| 测试 | Android 模拟器（`Medium_Phone_API_37.0`，Android 17）+ `npx expo run:android` 开发版；adb + uiautomator 驱动 UI；类型检查 `pnpm --filter native check-types`。不使用 Expo Web 替代 | 本机环境检查 |

## 设计项

- [x] DES-001 导航重构（关联 REQ-001）
  - 实现方案：删除 `app/(drawer)/`、`app/modal.tsx`；新增 `app/(tabs)/_layout.tsx`（`Tabs`，两个 Tab：`index` 标题「人员」图标 `people`，`settings` 标题「设置」图标 `settings`，颜色取 `useThemeColor`）；根 `_layout.tsx` 的 Stack 只保留 `(tabs)`，`unstable_settings.anchor` 改为 `(tabs)`；`+not-found.tsx` 的返回链接指向 `/`。
  - 涉及文件：`apps/native/app/_layout.tsx`、`apps/native/app/(tabs)/_layout.tsx`（新增）、`apps/native/app/+not-found.tsx`、删除 `apps/native/app/(drawer)/**`、`apps/native/app/modal.tsx`
  - 接口与数据变化：路由变更
  - 验证方式：Android 模拟器上启动即为「人员」Tab；类型检查（typedRoutes）
  - 完成证据：Android 模拟器：启动即「人员」Tab（选中）、底部仅「人员 / 设置」、无抽屉；类型检查通过

- [x] DES-002 格式化工具（关联 REQ-002.04）
  - 实现方案：新增 `apps/native/lib/format.ts`：`formatCount(n)`（规则同 Web：1.2k、3.4M）。
  - 涉及文件：`apps/native/lib/format.ts`（新增）
  - 接口与数据变化：无
  - 验证方式：UI 测试中校验显示值
  - 完成证据：Android 模拟器校验 1.2k、3.4M 缩写

- [x] DES-003 人员卡片与骨架（关联 REQ-002.04、REQ-002.05、REQ-002.07、REQ-004）
  - 实现方案：`components/github/profile-card.tsx`：`Pressable` 包裹 HeroUI `Card`，`accessibilityRole="link"`、`accessibilityLabel`；头像 `expo-image`（`cachePolicy="memory-disk"`、占位色块、圆形 48）；文本用 `numberOfLines` 控制截断，数字用 `tabular-nums`；点击调用 `WebBrowser.openBrowserAsync(htmlUrl)`。骨架 `ProfileCardSkeleton` 用 HeroUI `Skeleton`。组件用 `memo`。
  - 涉及文件：`apps/native/components/github/profile-card.tsx`（新增）、`apps/native/components/github/list-state.tsx` 中的 `ProfileCardSkeleton`（新增，与状态组件合并）、`apps/native/package.json`（新增 `expo-image`）
  - 接口与数据变化：新增依赖 `expo-image`（Expo SDK 58 对应版本，经 `expo install` 安装）
  - 验证方式：UI 测试检查卡片字段与空字段隐藏
  - 完成证据：Android 模拟器：完整卡片字段、稀疏卡片隐藏空行、触控区域 ≥44dp；点击卡片由 Chrome 打开 `https://github.com/app-user-00`（从 Activity intent 精确比对）；截图检查

- [x] DES-004 人员列表页（关联 REQ-002）
  - 实现方案：`app/(tabs)/index.tsx`：顶部大标题 + 「N 人」；`SearchField`（受控，`useDebouncedValue` 300ms）；排序 Chip 行；`useInfiniteQuery(trpc.github.list.infiniteQueryOptions({ keyword, sort, limit: PAGE_SIZE }, { getNextPageParam: (p) => p.nextCursor ?? undefined }))`；`FlatList` 渲染 `pages.flatMap(items)`，`keyExtractor` 用 `id`，`onEndReached` 在 `hasNextPage && !isFetchingNextPage` 时 `fetchNextPage`，`RefreshControl` 下拉 `refetch`，`ListFooterComponent` 显示 `Spinner`；空 / 无匹配 / 错误 / 骨架状态组件 `components/github/list-state.tsx`（空状态插画用 Ionicons 大图标组合）。
  - 涉及文件：`apps/native/app/(tabs)/index.tsx`（新增）、`apps/native/components/github/list-state.tsx`（新增）、`apps/native/hooks/use-debounced-value.ts`（新增）
  - 接口与数据变化：调用 `github.list`
  - 验证方式：UI 测试：总数、搜索、排序、加载更多、空 / 无匹配 / 错误 + 重试
  - 完成证据：Android 模拟器：下拉刷新、总数、搜索 / 清空 / 无匹配、排序、上拉加载到末页且之后不再请求、断网加载失败后重试、加载更多失败后重试（CR 回归）

- [x] DES-005 设置页（关联 REQ-003）
  - 实现方案：`app/(tabs)/settings.tsx`：主题二选一（两个 `Chip`），`app-theme-context` 启动时把 Uniwind 的自适应模式固定为浅色，不跟随系统（需求变更：去掉「跟随系统」）；连接状态卡片使用 `useQuery(trpc.healthCheck.queryOptions())`；版本号 `Constants.expoConfig?.version`。
  - 涉及文件：`apps/native/app/(tabs)/settings.tsx`（新增）、`apps/native/contexts/app-theme-context.tsx`
  - 接口与数据变化：调用 `healthCheck`
  - 验证方式：UI 测试：切换深色、连接状态、版本号
  - 完成证据：Android 模拟器：只有浅色 / 深色两项且默认浅色、切换立即生效、系统切换深浅色时 App 主题不变、系统深色时冷启动仍为浅色；已连接 / 未连接、版本 1.0.0

- [x] DES-006 UI 测试（关联 REQ-001 – REQ-004）
  - 实现方案：在 Android 模拟器上安装开发版（`npx expo run:android`），用 `adb reverse` 转发 3000 / 8081，带 `__expo_disable_*` 参数的链接启动以跳过开发者菜单；adb + uiautomator 读取界面树（`accessibilityLabel` 即 `content-desc`）并点击 / 滑动 / 输入，按验收条件断言；从 Activity intent 读取浏览器打开的网址；用原始截图像素计算背景亮度与文字对比度。不使用 Expo Web 替代。
  - 涉及文件：无仓库文件（脚本在会话临时目录）
  - 接口与数据变化：无
  - 验证方式：脚本断言全部通过
  - 完成证据：Android 模拟器验收 15/16 通过，唯一失败项「跟随系统」已按需求变更删除；主题专项复测 5/5 通过。空数据提示补测通过。全部验收条件在 Android 模拟器上通过

## 待确认项

- 新增依赖 `expo-image`：需求明确要求，属于 Expo SDK 官方包，不引入其他新技术。
- AGENTS.md 将 native 目录描述为 `(drawer)/(tabs)`；本设计按需求移除 Drawer，交付后 AGENTS.md 该行与代码不一致（workflow 规定不修改 AGENTS.md），需用户后续更新。
