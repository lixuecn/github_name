# Lambda 部署

## 打包与上传

在仓库根目录运行：

```sh
pnpm --filter server package:lambda
```

产物为 `apps/server/dist/lambda.zip`。将 ZIP 本身上传至 Lambda 的「代码 → 上传自 → .zip 文件」。保留完整 ZIP 内容，入口文件 `lambda.mjs` 位于根目录。

- 运行时：Node.js 22.x
- 处理程序：`lambda.handler`（代码页下方「运行时设置 → 编辑」）
- 建议初始内存：512 MB
- 建议初始超时：15 秒
- API 入口：API Gateway HTTP API 的 Lambda proxy integration，payload v2，转发原始路径；配置 `$default` 路由或 `/` 和 `/{proxy+}`，避免重复添加 `/api` 前缀。

此构建使用当前 Hono 4 的 `hono/aws-lambda`，将工作区代码和运行依赖全部打包；Prisma 7 的 WASM 查询编译器也在包中，不需要上传本地 node_modules。只打包 Lambda 入口，不启动监听端口的 Node 服务。本地启动方式不变。

## 环境变量

在「配置 → 环境变量」中设置，实际密钥只填入 AWS，不写入仓库或 ZIP。

| 键 | 值 |
| --- | --- |
| NODE_ENV | production |
| DATABASE_URL | `postgresql://postgres:URL编码后的密码@RDS端点:5432/github_name?sslmode=verify-full` |
| NODE_EXTRA_CA_CERTS | `/var/runtime/ca-cert.pem` |
| CORS_ORIGIN | 实际网页来源，例如 `https://example.com`，不要加路径或尾部斜杠 |
| GITHUB_TOKEN | 可选。GitHub 个人访问令牌（无需任何权限），配置后 GitHub API 限额从 60 次/小时提升到 5000 次/小时 |
| GO_API_URL | 可选。内部 Go 服务（`apps/go-api`）地址，例如内网 ALB 的 `http://internal-xxx.ap-southeast-2.elb.amazonaws.com`。配置后 `github.list` 改为通过 Go 服务读取，写操作仍直连数据库；不配置则全部走 Prisma。Lambda 需能在 VPC 内访问该地址（安全组放行） |

Lambda 构建通过 env.lambda.ts 在运行时校验上述应用环境变量；不会读取或上传本地 .env。原有 Varlock .env.schema 继续用于本地开发。

## 网络和建表

Lambda 与 RDS 关联同一个 VPC。RDS 安全组允许来自 Lambda 安全组的 TCP 5432；Lambda 出站规则允许连接数据库。公网访问保持关闭。

数据库新建后尚无应用表。请从可达数据库的跳板机或部署环境执行迁移：

```sh
pnpm --filter @my-better-t-app/db db:migrate:deploy
```

迁移环境需要生产 DATABASE_URL，以及可信的 RDS CA/TLS 配置。不要在每次 Lambda 请求中执行迁移，也不要用 migrate dev 部署生产数据库。私有 RDS 不能从普通本地网络直接连接。

关联 VPC 后，GitHub 等公网 API 访问需要另行配置 NAT 或其他出网方案；本包不创建任何 AWS 资源。

## 验证

Lambda 测试事件应模拟 HTTP API v2，不能使用空的 `{}`：

```json
{
  "version": "2.0",
  "routeKey": "$default",
  "rawPath": "/",
  "rawQueryString": "",
  "headers": { "host": "api.example.com" },
  "requestContext": {
    "domainName": "api.example.com",
    "http": {
      "method": "GET",
      "path": "/",
      "sourceIp": "203.0.113.10",
      "protocol": "HTTP/1.1"
    }
  },
  "isBase64Encoded": false
}
```

预期为 statusCode 200、body `OK`。这只确认后端启动，不确认数据库连接。迁移后还应从前端调用访问数据库的接口，确认 TLS、数据库权限和 CORS。
