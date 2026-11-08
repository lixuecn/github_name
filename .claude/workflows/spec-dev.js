export const meta = {
  name: 'spec-dev',
  description: '读取 docs/ 需求与 AGENTS.md，在 specs/ 生成需求/设计/任务文档，并逐个目录开发、Codex CR、测试直到交付',
  whenToUse: '按 docs/ 中的需求文档完成从规格到交付的全流程；args: { dir?: 项目目录, notes?: 补充说明, answers?: 对待确认项的答复 }',
  phases: [
    { title: 'Intake', detail: '读取 docs/ 与 AGENTS.md，核对代码，按功能拆分目录' },
    { title: 'Specs', detail: '每个目录生成 requirements.md / design.md / task.md' },
    { title: 'Check', detail: '检查文档编号、链接、依赖与技术背景' },
    { title: 'Develop', detail: '按依赖顺序开发；可并行任务用 worktree 群组并交叉校验' },
    { title: 'Review', detail: 'Codex CR，Claude 品审确认可修复项' },
    { title: 'Fix & Test', detail: '修复并按项目类型运行自动化测试，失败则继续修复' },
    { title: 'Record', detail: '勾选 task.md / design.md，坑写入永久记忆' },
    { title: 'Deliver', detail: '交付前检查并汇总完成状态' },
  ],
}

const MAX_FIX_ROUNDS = 3

const input = typeof args === 'string' ? { dir: args } : (args ?? {})
const notes = input.notes ? `\n补充说明（来自用户）：${input.notes}` : ''
const answers = input.answers ? `\n用户对待确认项的答复：${JSON.stringify(input.answers)}` : ''

const RULES = `通用规则：
- 全部使用中文。不修改 docs/ 与 AGENTS.md；specs/ 下每个目录只允许 requirements.md、design.md、task.md 三个文件。
- 编号：需求 REQ-001 / REQ-001.01，设计 DES-001 / DES-001.01，任务 TASK-001 / TASK-001.01；增量更新时编号、目录名与完成状态保持不变。
- 未运行的测试不算通过；不编造内容，含糊处列为待确认项并标注假设。${notes}${answers}`

// ---------- schemas ----------

const QUESTION = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    question: { type: 'string' },
    blocking: { type: 'boolean', description: 'true 表示影响实现，必须先问用户' },
    assumption: { type: 'string', description: '不阻塞时继续采用的假设' },
  },
  required: ['id', 'question', 'blocking'],
}

const INTAKE_SCHEMA = {
  type: 'object',
  properties: {
    projectRoot: { type: 'string', description: '项目根目录绝对路径' },
    status: { type: 'string', enum: ['ok', 'needs-input'] },
    agentsMdFound: { type: 'boolean' },
    requirementDocs: { type: 'array', items: { type: 'string' } },
    referenceDocs: { type: 'array', items: { type: 'string' } },
    existingSpecs: { type: 'string', enum: ['none', 'same-source', 'unknown-source'] },
    staleSpecs: { type: 'array', items: { type: 'string' }, description: '需求已被替换、不再有对应需求的旧 specs 目录' },
    envBlockers: { type: 'array', items: { type: 'string' }, description: '本机缺失的开发 / 测试环境' },
    features: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: '如 01-github-api、02-web-github-admin' },
          title: { type: 'string' },
          scope: { type: 'string', description: '本目录负责的需求范围与共享能力归属' },
          dependsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['dir', 'title', 'scope', 'dependsOn'],
      },
    },
    questions: { type: 'array', items: QUESTION },
  },
  required: ['projectRoot', 'status', 'agentsMdFound', 'existingSpecs', 'features', 'questions'],
}

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    dir: { type: 'string' },
    written: { type: 'boolean' },
    questions: { type: 'array', items: QUESTION },
  },
  required: ['dir', 'written', 'questions'],
}

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    fixed: { type: 'array', items: { type: 'string' } },
    remaining: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'fixed', 'remaining'],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    alreadyDone: { type: 'boolean', description: '本目录任务已全部勾选且验收仍满足' },
    groups: {
      type: 'array',
      description: '按依赖顺序排列的任务组；同组任务互不依赖且不改同一文件',
      items: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                summary: { type: 'string' },
                files: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'summary', 'files'],
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
  required: ['alreadyDone', 'groups'],
}

const DEV_SCHEMA = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    done: { type: 'boolean' },
    branch: { type: 'string', description: 'worktree 模式下提交改动的分支名；非 worktree 模式为空' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['taskId', 'done', 'changedFiles', 'notes'],
}

const CROSSCHECK_SCHEMA = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    matchesSpec: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['taskId', 'matchesSpec', 'problems'],
}

const CR_SCHEMA = {
  type: 'object',
  properties: {
    available: { type: 'boolean', description: 'Codex review 是否成功执行' },
    reason: { type: 'string' },
    rawOutput: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'string' },
          title: { type: 'string' },
          location: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['title', 'detail'],
      },
    },
  },
  required: ['available', 'findings'],
}

const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    confirmed: { type: 'array', items: { type: 'string', description: '确认成立且需修复的问题与修复方向' } },
    rejected: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, reason: { type: 'string' } },
        required: ['title', 'reason'],
      },
    },
  },
  required: ['confirmed', 'rejected'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    unfixable: { type: 'array', items: { type: 'string' } },
  },
  required: ['fixed', 'unfixable'],
}

const TEST_SCHEMA = {
  type: 'object',
  properties: {
    projectTypes: { type: 'array', items: { type: 'string', enum: ['web', 'app', 'backend'] } },
    commands: { type: 'array', items: { type: 'string' } },
    passed: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    notRun: { type: 'array', items: { type: 'string', description: '未能运行的验收项及原因' } },
    fixable: { type: 'boolean', description: '失败是否还能通过修改代码解决' },
  },
  required: ['projectTypes', 'commands', 'passed', 'failures', 'notRun', 'fixable'],
}

const RECORD_SCHEMA = {
  type: 'object',
  properties: {
    tasksChecked: { type: 'array', items: { type: 'string' } },
    designsChecked: { type: 'array', items: { type: 'string' } },
    reopened: { type: 'array', items: { type: 'string' } },
  },
  required: ['tasksChecked', 'designsChecked', 'reopened'],
}

const DELIVER_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'problems'],
}

// ---------- helpers ----------

function topoSort(features) {
  const byDir = new Map(features.map((f) => [f.dir, f]))
  const ordered = []
  const state = new Map()
  const visit = (f, stack) => {
    if (state.get(f.dir) === 'done') return
    if (state.get(f.dir) === 'visiting') {
      throw new Error(`specs 目录依赖存在循环：${[...stack, f.dir].join(' -> ')}`)
    }
    state.set(f.dir, 'visiting')
    for (const dep of f.dependsOn) {
      const target = byDir.get(dep)
      if (target) visit(target, [...stack, f.dir])
    }
    state.set(f.dir, 'done')
    ordered.push(f)
  }
  for (const f of [...features].sort((a, b) => a.dir.localeCompare(b.dir))) visit(f, [])
  return ordered
}

function memoryDirFor(root) {
  return `~/.claude/projects/${root.replace(/\//g, '-')}/memory/`
}

// ---------- Intake ----------

phase('Intake')
const intake = await agent(
  `你是需求分析员。目标项目目录：${input.dir ?? '当前工作目录'}。
1. 读取该目录 docs/ 下所有 Markdown（含子目录），区分需求文档和技术资料。docs/ 不存在或没有需求文档时 status=needs-input 并在 questions 中说明，不编造。
2. 读取 AGENTS.md 及其引用的文档，再用项目结构与依赖配置（package.json、lockfile、目录树）核对。AGENTS.md 不存在时 agentsMdFound=false，并加一条 blocking 问题「是否在没有 AGENTS.md 的情况下继续（以实际代码为准）」。AGENTS.md 描述的模块在代码中已不存在（或反之）时，以实际代码为准，并把差异写进相关目录的 scope。
3. 检查 specs/：不存在 → none；内容来自同一批需求 → same-source（沿用已有目录名与编号）；来源不明 → unknown-source 并加 blocking 问题，不要覆盖。docs/ 中的需求已被替换、旧目录不再有对应需求时，列入 staleSpecs 并加 blocking 问题「是否删除这些旧目录」，不擅自保留或删除。
4. 按「可独立验收」的功能拆分目录（01-xxx、02-xxx，kebab-case 英文），共享能力（如数据模型、共享校验）只归属一个目录，写进 scope；dependsOn 写依赖的目录名。需求涉及多端时按端拆分：服务端能力（数据模型、接口、第三方 API 接入）单独成目录且编号最前，Web 端、App 端各成一个目录并依赖它，例如 01-github-api、02-web-github-admin、03-native-github-list。
5. 只拆分需求文档涉及的内容，不扩大范围。影响实现的含糊点设为 blocking 问题，不影响的给出 assumption。
6. 检查本机开发与测试环境（Node 版本、数据库、浏览器、App 模拟器或真机、Codex CLI），缺失项写入 envBlockers（不作为 blocking 问题，之后写入对应 task.md 并标为阻塞）。
本步骤只读，不写任何文件。projectRoot 返回绝对路径。
${RULES}`,
  { label: 'intake', phase: 'Intake', schema: INTAKE_SCHEMA },
)

if (!intake) return { status: 'failed', reason: 'Intake agent 未返回结果' }
const root = intake.projectRoot
const blockingIntake = intake.questions.filter((q) => q.blocking)
if (intake.status === 'needs-input' || blockingIntake.length > 0) {
  return {
    status: 'needs-input',
    stage: 'intake',
    questions: blockingIntake.length > 0 ? blockingIntake : intake.questions,
    hint: '请向用户确认后，以 args.answers 重新运行本工作流',
  }
}
log(`拆分为 ${intake.features.length} 个目录：${intake.features.map((f) => f.dir).join('、')}`)

const ordered = topoSort(intake.features)
const featureList = ordered
  .map((f) => `- ${f.dir}《${f.title}》：${f.scope}${f.dependsOn.length ? `（依赖 ${f.dependsOn.join('、')}）` : ''}`)
  .join('\n')

// ---------- Specs ----------

phase('Specs')
const specs = await pipeline(ordered, (f) =>
  agent(
    `你是规格作者，项目根目录 ${root}。为目录 specs/${f.dir}/ 生成（或增量更新）三份文档，且只生成这三份。
需求来源：${(intake.requirementDocs ?? []).join('、')}；技术资料：${(intake.referenceDocs ?? []).join('、')}；AGENTS.md：${intake.agentsMdFound ? '存在' : '不存在（以实际代码为准，并在 design.md 标注缺失）'}。
全部目录划分（共享能力只在归属目录实现，其他目录用相对链接引用）：
${featureList}
本目录范围：${f.scope}
本机缺失的环境：${(intake.envBlockers ?? []).join('、') || '无'}（与本目录相关的写入 task.md 并标为阻塞）

requirements.md：目标、用户、范围、非目标；REQ 编号；每项写业务规则、触发条件、预期结果、异常边界和可验证的验收条件，不写「功能正常」这类泛化描述；待确认项与假设单列。
design.md：开头「技术背景」只列与本功能相关的技术栈、目录结构、架构分层、编码规范、测试命令、可复用模块，每条注明来源文件；设计项格式：
- [ ] DES-001 标题（关联 REQ-001）
  - 实现方案 / 涉及文件（新文件标注“新增”）/ 接口与数据变化 / 验证方式 / 完成证据：待开发
优先复用现有模块并写真实路径；引入 AGENTS.md 与现有依赖之外的技术要说明理由并列为待确认项；AGENTS.md 与代码或需求不一致时记录差异并列为待确认项，不擅自取舍。
task.md：按依赖顺序拆分 TASK，使用 - [ ]；每项写关联 REQ/DES、具体工作、涉及文件、前置依赖（跨目录写任务编号和相对链接）、验证方式。
生成时不勾选任何项。已有同源文档时保留编号与完成状态，只做增量修改。
${RULES}`,
    { label: `spec:${f.dir}`, phase: 'Specs', schema: SPEC_SCHEMA },
  ),
)

const specQuestions = specs.filter(Boolean).flatMap((s) => s.questions.map((q) => ({ ...q, dir: s.dir })))
const missingSpecs = ordered.filter((f, i) => !specs[i]?.written).map((f) => f.dir)
if (missingSpecs.length > 0) log(`以下目录文档生成失败：${missingSpecs.join('、')}`)

// ---------- Check ----------

phase('Check')
const docCheck = await agent(
  `你是文档审查员，项目根目录 ${root}。检查 specs/ 下全部目录（${ordered.map((f) => f.dir).join('、')}）：
- 每项需求都有对应的设计和任务；REQ/DES/TASK 编号在各自文件内唯一；
- 所有相对链接有效；跨目录依赖无循环；
- 每份 design.md 都有注明来源的技术背景，引用的已有文件真实存在（标注“新增”的除外）；
- 每个目录只有 requirements.md、design.md、task.md；生成阶段没有任何勾选项。
能直接修正的就地修正（不改变编号与含义），无法修正的列在 remaining。
${RULES}`,
  { label: 'doc-check', phase: 'Check', schema: CHECK_SCHEMA },
)

const blockingSpec = specQuestions.filter((q) => q.blocking)
if (blockingSpec.length > 0 || (docCheck && !docCheck.ok && docCheck.remaining.length > 0)) {
  return {
    status: 'needs-input',
    stage: 'specs',
    questions: blockingSpec,
    docProblems: docCheck?.remaining ?? [],
    hint: '文档已生成。请向用户确认后，以 args.answers 并配合 resumeFromRunId 重新运行，已完成的步骤会命中缓存',
  }
}

// ---------- Develop → Review → Fix & Test → Record (per directory) ----------

const results = []
const blocked = new Set()

for (const f of ordered) {
  const deps = f.dependsOn.filter((d) => blocked.has(d))
  if (deps.length > 0 || missingSpecs.includes(f.dir)) {
    blocked.add(f.dir)
    results.push({ dir: f.dir, status: 'skipped', reason: deps.length ? `依赖目录阻塞：${deps.join('、')}` : '文档未生成' })
    log(`跳过 ${f.dir}`)
    continue
  }

  const specRef = `specs/${f.dir}/（requirements.md、design.md、task.md）`

  phase('Develop')
  const plan = await agent(
    `读取 ${root}/${specRef}，把 task.md 中未勾选的任务按依赖顺序分组：同组任务必须互不依赖且不修改同一文件，否则放入后续组。
若全部任务已勾选，检查已完成的实现是否仍满足验收条件：满足则 alreadyDone=true；不满足则在 task.md 重新打开相关任务、取消对应设计项勾选并写明原因，再按上述规则分组。只读代码，不实现。`,
    { label: `plan:${f.dir}`, phase: 'Develop', schema: PLAN_SCHEMA },
  )
  if (!plan) {
    blocked.add(f.dir)
    results.push({ dir: f.dir, status: 'blocked', reason: '任务规划失败' })
    continue
  }
  if (plan.alreadyDone) {
    results.push({ dir: f.dir, status: 'done', reason: '已完成且验收仍满足' })
    continue
  }

  const devNotes = []
  for (const [gi, group] of plan.groups.entries()) {
    const devPrompt = (t, worktree) =>
      `你是开发者，项目根目录 ${root}。实现 ${specRef} 中的 ${t.id}：${t.summary}。涉及文件：${t.files.join('、')}。
遵循 design.md 的技术背景与对应 DES 设计项，以及 AGENTS.md 的编码规范；只做该任务，不扩大范围，不勾选文档。
${worktree
  ? `你在独立 worktree 中工作：先执行 \`git -C ${root} diff --binary HEAD | git apply --index\`，并把 \`git -C ${root} ls-files --others --exclude-standard\` 列出的未跟踪文件复制过来，提交为 "sync"；完成后再提交一次 "work"，branch 返回当前分支名。`
  : '直接在项目工作区修改，不要提交。'}`

    if (group.tasks.length === 1) {
      const t = group.tasks[0]
      const r = await agent(devPrompt(t, false), { label: `dev:${f.dir}:${t.id}`, phase: 'Develop', schema: DEV_SCHEMA })
      devNotes.push(r ?? { taskId: t.id, done: false, changedFiles: [], notes: 'agent 未返回' })
      continue
    }

    log(`${f.dir} 第 ${gi + 1} 组 ${group.tasks.length} 个任务并行开发（worktree 隔离）`)
    const devs = await parallel(
      group.tasks.map((t) => () =>
        agent(devPrompt(t, true), {
          label: `dev:${f.dir}:${t.id}`,
          phase: 'Develop',
          schema: DEV_SCHEMA,
          isolation: 'worktree',
        }),
      ),
    )
    const finished = devs.filter(Boolean).filter((d) => d.done && d.branch)

    // 每个 agent 校验另一个 agent 的改动（环形分配）
    const checks = await parallel(
      finished.map((d, i) => () => {
        const reviewer = finished.length > 1 ? finished[(i + 1) % finished.length].taskId : 'peer'
        return agent(
          `你是 ${reviewer} 的开发者，现在交叉校验 ${d.taskId} 的改动：在 ${root} 执行 \`git diff ${d.branch}~1 ${d.branch}\`，对照 ${specRef} 中对应的 REQ 与 DES 检查是否满足需求、是否越界修改、是否与本组其他任务冲突。只读，不改代码。`,
          { label: `crosscheck:${f.dir}:${d.taskId}`, phase: 'Develop', schema: CROSSCHECK_SCHEMA },
        )
      }),
    )
    const problems = checks.filter(Boolean).filter((c) => !c.matchesSpec)

    await agent(
      `你是合并者，项目根目录 ${root}。依次把以下分支的 "work" 提交合入主工作区（\`git diff --binary <branch>~1 <branch> | git apply\`），不要提交：
${finished.map((d) => `- ${d.taskId}: ${d.branch}`).join('\n')}
交叉校验发现的问题需在合并时一并修正：${problems.length ? JSON.stringify(problems) : '无'}。
有冲突时以 ${specRef} 的设计为准手工解决。合并完成后删除这些临时分支。`,
      { label: `merge:${f.dir}:g${gi + 1}`, phase: 'Develop' },
    )
    devNotes.push(...devs.map((d, i) => d ?? { taskId: group.tasks[i].id, done: false, changedFiles: [], notes: 'agent 未返回' }))
  }

  phase('Review')
  const cr = await agent(
    `在项目根目录 ${root} 运行 Codex 代码审查（等价于 /codex:review）：
- 找到插件脚本：\`ls -d ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs\`，取最新版本；设 CLAUDE_PLUGIN_ROOT 为其上级目录。
- 确保 \`codex\` 在 PATH 中（不在时尝试 ~/.nvm/versions/node/*/bin），并使用 Node ≥ 20.12。
- 执行 \`node "$CLAUDE_PLUGIN_ROOT/scripts/codex-companion.mjs" review "--wait --scope working-tree"\`，rawOutput 原样返回 "# Codex Review" 之后的内容，并把每条评论拆成 findings。
不要修复任何问题。脚本或 codex 不可用、未登录时 available=false 并在 reason 写明，不要用其他审查方式代替。`,
    { label: `codex-cr:${f.dir}`, phase: 'Review', schema: CR_SCHEMA },
  )
  if (!cr || !cr.available) {
    blocked.add(f.dir)
    results.push({ dir: f.dir, status: 'blocked', reason: `Codex CR 不可用：${cr?.reason ?? 'agent 未返回'}`, dev: devNotes })
    log(`${f.dir} 阻塞：Codex CR 不可用`)
    continue
  }

  const triage = cr.findings.length === 0
    ? { confirmed: [], rejected: [] }
    : await agent(
        `你是品审者，项目根目录 ${root}。逐条核实以下 Codex CR 结果是否成立、是否可修复（阅读相关代码，必要时运行最小复现），对照 ${specRef} 判断是否属于本目录范围：
${JSON.stringify(cr.findings, null, 2)}
confirmed 只放确认成立且应修复的问题；不修复的放 rejected 并写明理由（之后会写入 task.md）。`,
        { label: `triage:${f.dir}`, phase: 'Review', schema: TRIAGE_SCHEMA },
      )

  phase('Fix & Test')
  let toFix = triage?.confirmed ?? []
  let test = null
  let unfixable = []
  for (let round = 1; round <= MAX_FIX_ROUNDS; round += 1) {
    if (toFix.length > 0) {
      const fix = await agent(
        `你是开发者，项目根目录 ${root}。修复以下问题，遵循 ${specRef} 的设计与 AGENTS.md 规范，只改与问题相关的代码，不提交：
${toFix.map((x, i) => `${i + 1}. ${x}`).join('\n')}`,
        { label: `fix:${f.dir}:r${round}`, phase: 'Fix & Test', schema: FIX_SCHEMA },
      )
      unfixable = fix?.unfixable ?? []
    }
    test = await agent(
      `你是测试者，项目根目录 ${root}。根据代码判断项目类型并运行自动化测试，覆盖 ${specRef} 的全部验收条件：
- 优先使用 AGENTS.md 中的测试命令与项目已有测试框架，必要时为本目录补充测试；
- 网页：浏览器端到端测试；App：模拟器或真机 UI 测试；后端：接口测试与集成测试；
- 还要运行类型检查与 lint（如 AGENTS.md 所列）。
未实际运行的测试不算通过，写入 notRun 并说明原因。只修改测试代码，不修改业务代码。`,
      { label: `test:${f.dir}:r${round}`, phase: 'Fix & Test', schema: TEST_SCHEMA },
    )
    if (!test || test.passed || !test.fixable) break
    toFix = test.failures
    log(`${f.dir} 第 ${round} 轮测试失败（${test.failures.length} 项），继续修复`)
  }

  const passed = Boolean(test?.passed)
  if (!passed) blocked.add(f.dir)

  phase('Record')
  const record = await agent(
    `更新 ${root}/specs/${f.dir}/ 的 task.md 与 design.md：
- 测试${passed ? '已通过' : '未通过'}。${passed ? '勾选已完成且验证过的任务，记录改动文件与测试结果；设计项的关联任务全部完成后勾选并填写完成证据（不能只更新 task.md）。' : '保持未完成项为 - [ ] 并记录问题与实际进度。'}
- 测试结果：${JSON.stringify(test ?? { error: '测试 agent 未返回' })}
- Codex CR 未修复项及理由：${JSON.stringify(triage?.rejected ?? [])}；无法修复项：${JSON.stringify(unfixable)}
- 未运行的测试对应的任务不能勾选。`,
    { label: `record:${f.dir}`, phase: 'Record', schema: RECORD_SCHEMA },
  )

  await agent(
    `回顾 ${f.dir} 的开发记录，把开发中遇到的坑或值得注意的问题写入 Claude 永久记忆目录 ${memoryDirFor(root)}：每条一个文件（frontmatter: name / description / metadata.type: project|feedback|reference），内容包括现象、原因、处理方式，并在 MEMORY.md 追加一行索引；已有同主题记忆则更新而不是新建。没有值得记录的内容就什么都不写。
开发记录：${JSON.stringify({ dev: devNotes, cr: cr.findings, triage, test })}`,
    { label: `memory:${f.dir}`, phase: 'Record' },
  )

  results.push({
    dir: f.dir,
    status: passed ? 'done' : 'blocked',
    reason: passed ? '' : `测试未通过：${(test?.failures ?? ['测试 agent 未返回']).join('；')}`,
    tests: test,
    crFindings: cr.findings.length,
    crRejected: triage?.rejected ?? [],
    record,
  })
}

// ---------- Deliver ----------

phase('Deliver')
const deliver = await agent(
  `交付前检查（项目根目录 ${root}）：每项需求都有对应的设计和任务，编号唯一且未被改动，链接有效，依赖无循环；每份 design.md 都有注明来源的技术背景，涉及的已有文件真实存在；task.md 与 design.md 的勾选与完成证据一致。只报告问题，不修改文件。`,
  { label: 'deliver-check', phase: 'Deliver', schema: DELIVER_SCHEMA },
)

return {
  status: results.every((r) => r.status === 'done') ? 'delivered' : 'partial',
  directories: results.map((r) => ({
    dir: r.dir,
    status: r.status,
    reason: r.reason,
    testsPassed: r.tests?.passed ?? false,
    testCommands: r.tests?.commands ?? [],
    notRun: r.tests?.notRun ?? [],
    crFindings: r.crFindings ?? 0,
  })),
  openQuestions: specQuestions.filter((q) => !q.blocking),
  deliveryCheck: deliver,
}
