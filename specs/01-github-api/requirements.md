# 01 GitHub 人员后端能力 — 需求

来源：[docs/需求.md](../../docs/需求.md) §1、§2.1–2.5（服务端部分）、§4.1、§4.2、§5、§6「工程」。

## 目标

为 Web 管理端（[02](../02-web-github-admin/requirements.md)）与 Android 展示端（[03](../03-native-github-list/requirements.md)）提供 GitHub 人员数据的存储、查询、GitHub 资料拉取与同步、频率限制等服务端能力。本目录是数据模型、共享校验与 tRPC `github` 路由的唯一归属。

## 用户

- Web 管理端、Android App（通过 tRPC 调用，无登录）
- 运维人员（配置 `GITHUB_TOKEN`、执行数据库迁移）

## 范围

- `GithubProfile` 数据模型与迁移
- 前后端共享的校验规则与常量
- 服务端 GitHub REST API 客户端（按用户名、按用户 ID 查询）
- tRPC 过程：`github.search`、`github.list`、`github.create`、`github.update`、`github.sync`、`github.delete`
- 按 IP 的频率限制、可选 `GITHUB_TOKEN`
- 服务端自动化测试

## 非目标

- 登录、权限；人员详情接口（需求已取消详情页）
- GitHub 仓库 / 提交等资料以外的数据；定时同步
- 前端 UI（见 02、03）

## 需求

### REQ-001 GitHub 人员数据存储

- REQ-001.01 系统保存人员的 GitHub 公开资料：`githubId`、`login`、`name`、`bio`、`company`、`location`、`blog`、`twitterUsername`、`avatarUrl`、`htmlUrl`、`publicRepos`、`followers`、`following`、`githubCreatedAt`，以及系统字段 `note`、`tags`、`syncedAt`、`createdAt`、`updatedAt`。
  - 验收：迁移后数据库存在对应表与字段；`githubId` 唯一；`login` 有索引。
- REQ-001.02 以 GitHub 用户 ID 去重：同一 `githubId` 只能存在一条记录。
  - 验收：重复插入同一 `githubId` 时，第二次失败并返回 `CONFLICT`「该用户已在系统中」。

### REQ-002 搜索 GitHub 用户（`github.search`）

- REQ-002.01 输入用户名，服务端调用 GitHub `GET /users/{username}` 返回公开资料，并附带 `existsInSystem`（按 `githubId` 判断是否已加入）。
  - 业务规则：入参去除首尾空格；1–39 个字符，仅字母、数字、连字符，不能以连字符开头或结尾。
  - 异常：格式不合法 → `BAD_REQUEST`「GitHub 用户名格式不正确」，不请求 GitHub。
  - 验收：查询存在的用户返回完整字段与正确的 `existsInSystem`；非法用户名不发出 GitHub 请求。
- REQ-002.02 错误映射：GitHub 404 → `NOT_FOUND`「未找到该 GitHub 用户」；GitHub 429，或 403 且限流（`x-ratelimit-remaining: 0` 或带 `retry-after`）→ `TOO_MANY_REQUESTS`「GitHub 请求过于频繁，请稍后再试」；超时（10s）或其他错误 → `BAD_GATEWAY`「查询失败，请稍后重试」。
  - 验收：分别模拟 404、403 限流、429、500、超时，返回对应错误码与文案。
- REQ-002.03 同一用户名的成功查询结果在服务端缓存 60 秒（大小写不敏感），期间重复搜索不再请求 GitHub；`existsInSystem` 每次实时计算。
  - 验收：60 秒内两次搜索同一用户名，GitHub 只被请求一次；第二次的 `existsInSystem` 反映最新数据库状态。

### REQ-003 加入系统（`github.create`）

- REQ-003.01 入参 `username`（规则同 REQ-002.01）与可选 `note`（去除首尾空格，≤200 字，空串视为无备注）。服务端重新从 GitHub 拉取资料后入库，不接受前端传入的资料字段；`syncedAt` 为入库时间，`tags` 为空数组。
  - 异常：GitHub 错误同 REQ-002.02；已存在 → `CONFLICT`「该用户已在系统中」；备注超长 → `BAD_REQUEST`。
  - 验收：成功后数据库新增一条记录，字段与 GitHub 返回一致；重复添加返回 `CONFLICT`。

### REQ-004 人员列表（`github.list`）

- REQ-004.01 分页查询：入参 `keyword?`、`sort`（`createdAt` 默认 | `followers` | `publicRepos`，均倒序）、`cursor?`、`limit`（默认 20，最大 50）；返回 `items`、`total`（满足过滤条件的总数）、`nextCursor`（无下一页为 `null`）。
  - 业务规则：`keyword` 去除首尾空格后对 `login`、`name`、`note` 做大小写不敏感的包含匹配；空关键字不过滤。排序值相同时按 `id` 倒序，保证翻页稳定、无重复无遗漏。
  - 异常：`cursor` 指向的记录已被删除时不报错，返回第一页。
  - 验收：25 条数据时第一页 20 条、`nextCursor` 非空，第二页 5 条、`nextCursor` 为 `null`；三种排序结果正确；关键字匹配 login / name / note。

### REQ-005 编辑（`github.update`）

- REQ-005.01 入参 `id`、可选 `note`（规则同 REQ-003.01，传 `null` 或空串清空）、可选 `tags`（去除首尾空格、去掉空项与重复项后 ≤5 个，每个 ≤20 字）。只更新传入的字段，不改 GitHub 字段与 `syncedAt`。
  - 异常：记录不存在 → `NOT_FOUND`「该人员不存在」；超限 → `BAD_REQUEST`。
  - 验收：修改后再次 `list` 返回新值；GitHub 字段不变。

### REQ-006 从 GitHub 同步（`github.sync`）

- REQ-006.01 按记录的 `githubId` 调用 GitHub `GET /user/{id}`，覆盖全部 GitHub 字段（含已变更的 `login`）并更新 `syncedAt`，保留 `note`、`tags`。
  - 异常：记录不存在 → `NOT_FOUND`「该人员不存在」；GitHub 404 → `NOT_FOUND`「该 GitHub 用户已不存在」且记录保留；限流 / 其他错误同 REQ-002.02。
  - 验收：模拟 login 变更后同步，记录的 login 更新、备注 / 标签不变、`syncedAt` 变大；模拟 404 时记录仍存在。

### REQ-007 删除（`github.delete`）

- REQ-007.01 入参 `id`，删除系统记录，不涉及 GitHub。
  - 异常：记录不存在 → `NOT_FOUND`「该人员不存在」。
  - 验收：删除后 `list` 不再返回该记录。

### REQ-008 频率限制

- REQ-008.01 `search`、`create`、`update`、`sync`、`delete` 按客户端 IP 共享计数，每个 IP 每 60 秒最多 30 次；超出返回 `TOO_MANY_REQUESTS`「请求过于频繁，请稍后再试」。`list` 与 `healthCheck` 不限流。
  - 业务规则：客户端 IP 取服务端连接的对端地址（Node：socket；Lambda：API Gateway `sourceIp`），不信任客户端可伪造的 `x-forwarded-for`；取不到 IP 时归入同一个 `unknown` 桶。
  - 验收：同一 IP 第 31 次调用返回 `TOO_MANY_REQUESTS`；不同 IP 互不影响；窗口过后恢复。

### REQ-009 GitHub 访问令牌

- REQ-009.01 可选环境变量 `GITHUB_TOKEN`：配置时 GitHub 请求携带 `Authorization: Bearer <token>`；未配置时匿名访问。令牌仅存在于服务端，不出现在接口响应与日志中。本地（Varlock `.env.schema`）与 Lambda（`env.lambda.ts`）均支持。
  - 验收：未配置时服务可启动、搜索可用；配置时请求头带令牌（单元测试校验）。

## 待确认项

- Q-01（假设）：`list` 的 `limit` 允许客户端传入，上限 50；需求只规定每页 20 条。
- Q-02（假设）：GitHub 非 404 / 限流错误使用 `BAD_GATEWAY`，前端统一显示「查询失败，请稍后重试」。
- Q-03（假设）：频率限制计数存于进程内存；Lambda 多实例时各实例独立计数，属于「尽力而为」。如需全局精确限流需引入共享存储。
