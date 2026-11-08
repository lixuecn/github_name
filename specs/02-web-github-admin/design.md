# 02 Web 端 GitHub 人员管理 — 设计

## 技术背景

| 项 | 内容 | 来源 |
| --- | --- | --- |
| 框架 | Next.js 16 App Router、React 19、React Compiler、`typedRoutes: true`；编写前查阅 `node_modules/next/dist/docs/` | `apps/web/next.config.ts`、`apps/web/AGENTS.md` |
| 样式 / 组件 | Tailwind v4；共享 shadcn 组件（Base UI，style `base-lyra`）位于 `packages/ui`，从 `@my-better-t-app/ui/components/*` 导入；新增组件用 `shadcn add -c packages/ui` | `AGENTS.md`、`packages/ui/components.json`、`README.md` |
| 已有组件 | `button`、`card`、`input`、`input-group`、`label`、`skeleton`、`sonner`、`textarea`、`empty`、`dropdown-menu`、`tooltip` | `packages/ui/src/components/` |
| 数据 | tRPC + TanStack Query：`useTRPC()` 生成 `queryOptions` / `mutationOptions`；`QueryCache.onError` 全局 toast | `apps/web/src/utils/trpc.ts`、`apps/web/src/components/providers.tsx` |
| 页面骨架 | 根布局 `Header` + 内容区；导航链接定义在 `header.tsx` 的 `links` | `apps/web/src/app/layout.tsx`、`apps/web/src/components/header.tsx` |
| 图标 / 提示 | `lucide-react`、`sonner`（`toast`） | `apps/web/package.json` |
| 后端接口 | `github.search / list / create / update / sync / delete`，共享校验 `@my-better-t-app/api/shared/github` | [01 design](../01-github-api/design.md) |
| 编码规范 | 函数组件、hooks 顶层调用、语义化 HTML、label 与 aria、`rel="noopener"`、不在组件内定义组件 | `AGENTS.md`「React & JSX」「Security」 |
| 测试 | 仓库无 Web 测试框架；用本机 Chrome headless + CDP（Node 22 内置 WebSocket）做端到端测试，脚本放会话临时目录 | 永久记忆（用户不接受新增 Playwright 依赖） |
| 命令 | `pnpm dev:web`（3001）、`pnpm --filter web check-types` | `AGENTS.md`「常用命令」 |

## 设计项

- [x] DES-001 新增共享 UI 组件（关联 REQ-004、REQ-005、REQ-007）
  - 实现方案：`pnpm dlx shadcn@latest add dialog alert-dialog table badge -c packages/ui`，保持 base-lyra 风格；生成后检查导入路径为 `@my-better-t-app/ui/...`。实现调整：排序改用带 label 的原生 `<select>`（可访问性更好、可稳定测试），故不新增 `select` 组件；`dialog.tsx` 关闭按钮的读屏文案改为「关闭」。
  - 涉及文件：`packages/ui/src/components/{dialog,alert-dialog,table,badge}.tsx`（新增）、`packages/ui/package.json`（如有新依赖）
  - 接口与数据变化：无
  - 验证方式：`pnpm check-types` 通过
  - 完成证据：4 个组件已加入 `packages/ui`；`pnpm check-types` 通过；E2E 中弹窗 / 确认框 / 表格 / 标签均正常

- [x] DES-002 导航入口与全局查询错误处理（关联 REQ-001、REQ-002.03）
  - 实现方案：`header.tsx` 的 `links` 增加 `{ to: "/github", label: "GitHub 人员" }`；`trpc.ts` 的 `QueryCache.onError` 在 `query.meta?.silent` 为真时跳过 toast，按钮文案改为「重试」，并在 `utils/trpc.ts` 中声明 `Register` 的 `queryMeta` 类型。
  - 涉及文件：`apps/web/src/components/header.tsx`、`apps/web/src/utils/trpc.ts`
  - 接口与数据变化：无
  - 验证方式：E2E 点击导航进入 `/github`；搜索不存在用户时无全局 toast
  - 完成证据：E2E「header link navigates」「unknown user shows inline error without a global toast」通过

- [x] DES-003 格式化工具（关联 REQ-002.02、REQ-004.01）
  - 实现方案：新增 `apps/web/src/lib/format.ts`：`formatCount(n)`（<1000 原样，1.2k、3.4M，去掉末尾 `.0`）、`formatRelativeTime(date, now?)`（`Intl.RelativeTimeFormat("zh-CN")`，<1 分钟显示「刚刚」）、`formatDate(date)`（`YYYY-MM-DD`）、`toSafeHttpUrl(value)`（补协议并只接受 http/https，否则返回 `null`）。
  - 涉及文件：`apps/web/src/lib/format.ts`（新增）
  - 接口与数据变化：无
  - 验证方式：E2E 中校验页面显示值；类型检查
  - 完成证据：E2E 校验 `YYYY-MM-DD 加入 GitHub`、「刚刚」、数值缩写与外链 `rel` 通过

- [x] DES-004 `/github` 页面与搜索区（关联 REQ-001、REQ-002、REQ-003、REQ-008）
  - 实现方案：`app/github/page.tsx`（服务端组件，导出 `metadata`，渲染客户端组件 `GithubAdmin`）。`github-search.tsx`：受控输入 + `<form onSubmit>`，提交时用 `githubUsernameSchema.safeParse` 校验，合法后设置 `submittedUsername`；`useQuery(trpc.github.search.queryOptions({ username }, { enabled: !!submitted, retry: false, meta: { silent: true } }))`；根据 `error.data.code` 显示文案。`github-profile-card.tsx`：展示资料、备注输入（显示剩余字数）与「加入系统」按钮，`useMutation(trpc.github.create.mutationOptions())`，成功后 `invalidateQueries` `github.list` 与当前 `github.search`。
  - 涉及文件：`apps/web/src/app/github/page.tsx`（新增）、`apps/web/src/app/github/_components/github-admin.tsx`（新增）、`github-search.tsx`（新增）、`github-profile-card.tsx`（新增）
  - 接口与数据变化：调用 `github.search`、`github.create`
  - 验证方式：E2E：非法输入、搜索成功、不存在、加入、重复加入、「已添加」
  - 完成证据：E2E 搜索 / 校验 / 加入 / 重复加入 / 已添加 共 7 项通过；修复「同名重复提交不重新请求」「后台刷新丢失备注草稿」（CR）

- [x] DES-005 人员列表区（关联 REQ-004）
  - 实现方案：`github-list.tsx`：关键字输入（300ms 防抖，自写 `useDebouncedValue`）、排序 `Select`；分页状态为游标栈 `cursors: (string|null)[]`，当前页 `cursors.at(-1)`；`useQuery(trpc.github.list.queryOptions({ keyword, sort, cursor, limit: PAGE_SIZE }, { placeholderData: keepPreviousData }))`；过滤 / 排序变化时重置游标栈。桌面 `Table`（`hidden md:block`），窄屏卡片列表（`md:hidden`）。状态：骨架 / 空 / 无匹配 / 错误 + 重试。操作列包含编辑、同步、删除按钮（带 `aria-label`）。
  - 涉及文件：`apps/web/src/app/github/_components/github-list.tsx`（新增）、`github-row-actions.tsx`（新增）、`apps/web/src/hooks/use-debounced-value.ts`（新增）
  - 接口与数据变化：调用 `github.list`
  - 验证方式：E2E：过滤、排序、分页、空状态、375px 无横向滚动
  - 完成证据：E2E 分页、过滤、排序、空状态、加载失败重试、375px 无横向滚动通过；修复「切回原排序恢复旧分页」

- [x] DES-006 编辑、同步、删除（关联 REQ-005、REQ-006、REQ-007）
  - 实现方案：`edit-profile-dialog.tsx`：`Dialog` 内备注 `Textarea` + 标签输入（回车 / 逗号添加，`Badge` 展示可删除），用 `noteSchema` / `tagsSchema` 校验，`github.update` 成功后 toast「保存成功」并关闭。同步：`github.sync` mutation，按行记录 pending，成功 toast「已同步」。删除：`AlertDialog` 确认后 `github.delete`，成功 toast「已删除」；若当前页仅剩这一项且有上一页则弹出游标。所有 mutation 成功或 `NOT_FOUND` 后 `invalidateQueries(trpc.github.list.pathFilter())`，错误 toast 显示 `error.message`。
  - 涉及文件：`apps/web/src/app/github/_components/edit-profile-dialog.tsx`（新增）、`delete-profile-dialog.tsx`（新增）、`github-row-actions.tsx`
  - 接口与数据变化：调用 `github.update`、`github.sync`、`github.delete`
  - 验证方式：E2E：编辑后刷新仍保留、同步时间变「刚刚」、删除确认 / 取消
  - 完成证据：E2E 编辑持久化、标签上限与 Esc、同步、删除取消 / 确认、末页删空回退通过；CR 修复删除后搜索卡片状态刷新

- [x] DES-007 端到端测试（关联 REQ-001 – REQ-008）
  - 实现方案：会话临时目录中的 Node 22 脚本：启动 headless Chrome（`--remote-debugging-port`），通过 CDP 导航 `http://localhost:3001/github`，用原生 setter + `input` 事件填写输入、`requestSubmit()` 提交，断言 DOM 文案、数据库（经 `github.list` HTTP 接口）状态；使用真实 GitHub API（匿名额度足够少量调用）与本地 PostgreSQL。
  - 涉及文件：无仓库文件（脚本在会话临时目录）
  - 接口与数据变化：无
  - 验证方式：脚本全部断言通过
  - 完成证据：Chrome CDP 脚本 21/21 通过（会话临时目录 `e2e-web.mjs`）

## 待确认项

- 新增的 shadcn 组件属于 AGENTS.md 规定的方式（`packages/ui`），不是新技术。
- E2E 不入库（遵循用户此前「不引入 Playwright」的决定），因此无法在 CI 复跑；如需入库请确认方案。
