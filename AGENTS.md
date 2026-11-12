# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `pnpm exec ultracite fix`
- **Check for issues**: `pnpm exec ultracite check`
- **Diagnose setup**: `pnpm exec ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**

- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome will catch most mechanical issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `pnpm exec ultracite fix` before committing to ensure compliance.

---

# 项目结构与技术架构

本项目由 [Better-T-Stack](https://better-t-stack.dev) 生成（见 `bts.jsonc`），是一个 **pnpm + Turborepo** 管理的全栈 TypeScript Monorepo。

## 技术栈总览

| 层 | 技术 |
| --- | --- |
| Monorepo / 构建 | pnpm workspaces（`catalog:` 统一依赖版本）、Turborepo |
| Web 前端 | Next.js 16（App Router、React 19、React Compiler）、Tailwind CSS v4、shadcn/ui（Base UI） |
| 移动端 | Expo 58 + Expo Router、React Native 0.88、HeroUI Native、Uniwind（Tailwind for RN） |
| 文档站 | Fumadocs（Next.js + MDX） |
| 后端 | Hono（Node 运行时，`@hono/node-server`），`tsx` 开发、`tsdown` 打包 |
| Go 数据服务 | Go 1.27、标准库 `net/http`、pgx v5、sqlc；**独立仓库 `go-api`**（本地约定检出在本仓库同级目录 `../go-api`），部署在 ECS Fargate |
| API | tRPC v11 + TanStack Query（`@trpc/tanstack-react-query`） |
| 数据库 | PostgreSQL + Prisma 7（`@prisma/adapter-pg` 驱动适配器） |
| 环境变量 | Varlock（`.env.schema` 声明 → 生成类型安全的 `env.ts`） |
| 表单 / 校验 | TanStack Form、Zod 4 |
| 代码质量 | Biome + Ultracite |

## 目录结构

```
.
├── apps/
│   ├── web/              # Next.js Web 前端（端口 3001）
│   │   └── src/
│   │       ├── app/          # App Router：/
│   │       ├── components/   # header、providers、主题切换等
│   │       ├── utils/trpc.ts       # tRPC + QueryClient 配置
│   │       └── env.ts        # Varlock 生成的类型化环境变量
│   ├── native/           # Expo 移动端
│   │   ├── app/              # Expo Router：(drawer)/(tabs)、modal、+not-found
│   │   ├── components/       # container、theme-toggle
│   │   ├── contexts/         # app-theme-context
│   │   ├── utils/trpc.ts
│   │   └── src/env.ts
│   ├── server/           # Hono API 服务（端口 3000）
│   │   └── src/
│   │       ├── app.ts        # createApp()：CORS、/trpc/*（tRPC）
│   │       ├── index.ts      # Node 入口；lambda.ts 为 AWS Lambda 入口
│   │       ├── services.ts   # 实例化 db（Prisma）
│   │       ├── context.ts    # 构建 tRPC context
│   │       └── env.server.ts / env.lambda.ts / env.ts
│   ├── infra/            # AWS CDK（TypeScript）：Go 服务的 ECR/CodeBuild/ECS、后端 Lambda（ServerStack）；详见其 README.md
│   └── fumadocs/         # 文档站（端口 4000），内容位于 content/docs/*.mdx
├── packages/
│   ├── api/              # @my-better-t-app/api：tRPC 实例、publicProcedure、appRouter
│   │   └── src/{index.ts, context.ts, routers/index.ts}
│   ├── db/               # @my-better-t-app/db：createPrismaClient() 工厂
│   │   └── prisma/
│   │       ├── schema/       # schema.prisma（在此目录新增模型）
│   │       └── migrations/
│   ├── ui/               # @my-better-t-app/ui：共享 shadcn 组件、hooks、globals.css（供 web 使用）
│   └── config/           # @my-better-t-app/config：共享 tsconfig.base.json
├── .agents/skills/       # AI Agent 技能（.claude/skills 为其符号链接）
├── biome.json            # Biome / Ultracite 配置
├── turbo.json            # Turborepo 任务管道
├── pnpm-workspace.yaml   # workspace、catalog 版本、overrides
└── bts.jsonc             # Better-T-Stack 元数据（用于 `create-better-t-stack add`）
```

## 架构与数据流

```
 web (Next.js) ──┐
                 ├── HTTP ──► server (Hono) /trpc/* → appRouter ─► Prisma ─► PostgreSQL
 native (Expo) ──┘
```

- **依赖方向**：`apps/*` → `packages/api` → `packages/db`。`packages/*` 不依赖 `apps/*`。
- **工厂 + 注入**：`packages/db` 只导出工厂函数 `createPrismaClient`，真正的实例在 `apps/server/src/services.ts` 中用服务端环境变量创建；新增服务端单例也应放在此处。
- **人员数据经 `ProfileStore` 读写**：tRPC 路由不直接用 Prisma，而是调用 `ctx.profiles`（`packages/api/src/profile-store.ts`），它有 Prisma 与 Go HTTP 两种实现，`apps/server/src/services.ts` 依据 `GO_API_URL` 选择（生产走 Go，本地默认 Prisma）。路由测试写成共享套件 `apps/server/test/github-router-suite.ts`，`github-router.test.ts` 用 Prisma 跑、`github-router-go.test.ts` 用真实 Go 服务跑（需要本地检出 Go 仓库，默认 `../go-api`，可用 `GO_API_DIR` 指定；缺失时跳过）。
- **Go 服务在独立仓库**：表结构仍归本仓库的 Prisma 管，Go 仓库的 `schema/migrations/` 是只读副本；**新增 Prisma 迁移后要到 Go 仓库运行 `make schema && make sqlc`**。Go 的接口与本仓库 `profile-store.ts`（Go 实现与 zod schema）需同步修改。
- **端到端类型安全**：前端只以类型方式导入 `AppRouter`（`@my-better-t-app/api/routers/index`），通过 `useTRPC()` + TanStack Query 调用。
- **无认证**：项目当前不包含登录注册，所有 tRPC 接口均为 `publicProcedure`。
- **内部包无需构建**：`packages/*` 直接通过 `exports` 指向 `src/*.ts` 源码。

## 常见开发任务

- **新增 API**：在 `packages/api/src/routers/` 中添加路由并合并进 `appRouter`。
- **修改数据模型**：编辑 `packages/db/prisma/schema/schema.prisma`，然后运行 `pnpm db:generate` 与 `pnpm db:push` / `pnpm db:migrate`。
- **新增环境变量**：在对应包的 `.env.schema` 中声明，运行 `pnpm env:generate` 生成类型，并在需要时加入 `turbo.json` 的 `globalEnv`。
- **新增 Web UI 组件**：放入 `packages/ui`（shadcn），从 `@my-better-t-app/ui/components/*` 导入。
- **Next.js 注意**：`apps/web/AGENTS.md` 提示该 Next.js 版本有破坏性变更，编写 Web 代码前先查阅 `node_modules/next/dist/docs/`。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动全部应用 |
| `pnpm dev:web` / `dev:server` / `dev:native` | 单独启动某个应用 |
| `pnpm build` / `pnpm check-types` | 构建 / 类型检查 |
| `pnpm db:push` / `db:migrate` / `db:generate` / `db:studio` | Prisma 数据库操作 |
| `pnpm env:generate` | 重新生成各包的类型化环境变量 |
| `pnpm check` / `pnpm fix` | Ultracite 检查 / 自动修复 |
