# 04 访问控制 — 需求

来源：[docs/需求.md](../../docs/需求.md)「功能需求 / 4. 访问控制」「验收标准」

## 目标

未登录用户无法访问受保护页面与接口；已登录用户不会再看到登录页。会话来源见 [01-registration](../01-registration/requirements.md)、[02-login](../02-login/requirements.md)，退出行为见 [03-logout-and-status](../03-logout-and-status/requirements.md)。

## 用户

Web 与移动端的所有用户。

## 范围

- Web `/dashboard`、`/login` 的服务端会话判断与重定向
- Native 首页按登录状态切换内容
- 后端受保护 tRPC 接口

## 非目标

- 角色 / 权限体系、管理员后台、按资源授权

## 需求

### REQ-001 Web 受保护页面

- REQ-001.01 未登录访问 `/dashboard` 时，重定向到 `/login`，不渲染任何受保护内容。
  - 验收：清空 cookie 后访问 `/dashboard`，最终 URL 为 `/login`；退出登录后访问 `/dashboard` 同样重定向。
- REQ-001.02 已登录访问 `/login` 时，重定向到 `/dashboard`。
  - 验收：登录后直接打开 `/login`，最终 URL 为 `/dashboard`。

### REQ-002 Native 首页

- REQ-002.01 未登录时首页显示登录与注册表单；已登录时隐藏表单，显示已登录卡片（[03-logout-and-status REQ-003.02](../03-logout-and-status/requirements.md)）。
  - 验收：登录前后首页内容按上述切换。

### REQ-003 后端接口保护

- REQ-003.01 需要登录的 tRPC 接口使用 `protectedProcedure`；未登录调用返回 `UNAUTHORIZED`（HTTP 401）。
- REQ-003.02 携带有效会话 cookie 调用时返回数据，且 `user` 为当前登录用户。
  - 验收：不带 cookie 调用 `privateData` 返回 401 与 `UNAUTHORIZED`；登录后调用返回 200 与当前用户名。
