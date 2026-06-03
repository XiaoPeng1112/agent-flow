# AgentFlow 项目架构

> 最后更新：2026-06-03（v2.8.7 — 产出物体系优化 + Skill 自动沉淀 + Skill 物化执行链路）  
> 维护者：@XiaoPeng1112

## 项目定位

AgentFlow 是一个 **AI 驱动的多 Agent 协作开发工作流引擎**，核心定位为 Agent 编排调度中心（Orchestrator）。它作为总控台连接本地终端、IDE 编辑器以及 Codex/Claude 等 AI 工具，实现从需求输入到代码交付的全流程闭环操作。

核心理念是 **MAF（Multi-Agent Flow）**——多角色 Agent 框架。将软件开发拆解为多个角色（规划者、管理者、执行者），每个角色由专门的 Agent 承担，通过 DAG（有向无环图）编排实现高效协作。

## 仓库信息

- **GitHub**: https://github.com/XiaoPeng1112/agent-flow
- **GitHub Pages**: https://xiaopeng1112.github.io/agent-flow/
- **分支策略**: main 为主分支
- **License**: MIT

## Monorepo 结构

```
agent-flow/
├── packages/
│   ├── client/          # 前端 React 应用
│   │   ├── src/
│   │   │   ├── api/         # API 客户端（REST 请求封装）
│   │   │   ├── components/  # UI 组件
│   │   │   │   ├── common/    # 通用组件（ErrorBoundary / RouteLoadingFallback）
│   │   │   │   ├── detail/    # Run 详情面板（DAG/AgentTree/Checkpoint/ContextDB/A2A/DiffReview/Metrics）
│   │   │   │   ├── layout/   # 布局组件（AppLayout）
│   │   │   │   └── sidebar/  # 侧边栏（Sidebar/AddProjectModal/UserPanel）
│   │   │   ├── hooks/       # 自定义 Hooks（useRequest / useLoadingAction）
│   │   │   ├── pages/       # 路由页面（Home/Project/RunDetail/Changelog/About）
│   │   │   ├── router/      # React Router 配置（React.lazy 代码分割）
│   │   │   ├── store/       # Zustand 状态管理
│   │   │   └── types/       # TypeScript 类型定义
│   │   ├── vite.config.ts
│   │   └── index.html
│   └── server/          # 后端 Express 服务
│       ├── tests/         # Vitest 单元测试（122 cases）
│       │   ├── workflow-engine.test.ts
│       │   ├── a2a-protocol.test.ts
│       │   └── contract-validator.test.ts
│       └── src/
│           ├── index.ts       # 服务入口（v2.8.7）
│           ├── routes/        # 模块化路由（v2.7.3 拆分）
│           │   ├── api.ts       # 路由聚合入口
│           │   ├── projects.ts  # 项目 + 模板路由
│           │   ├── runs.ts      # Run / Node / Turn 路由
│           │   ├── artifacts.ts # Metrics / DiffReview / Feedback / PR 路由
│           │   └── files.ts     # Skills / FileSystem / Git / Terminal 路由
│           ├── services/      # 业务服务层（24 个模块）
│           │   ├── project.ts       # 项目 CRUD
│           │   ├── template.ts      # 工作流模板管理（4 个内置模板，含 deliver 节点）
│           │   ├── workflow-engine.ts # DAG 工作流引擎（三层状态机 + Context Chaining）
│           │   ├── agent.ts         # Agent 调度（Codex/Claude CLI）
│           │   ├── auth.ts          # GitHub OAuth 认证（含 CSRF state 校验）
│           │   ├── skill.ts         # Skills 扫描与管理
│           │   ├── filesystem.ts    # 文件系统操作（allowedRoots 安全校验）
│           │   ├── git.ts           # Git 集成（状态/commit/diff）
│           │   ├── terminal.ts      # 终端进程管理
│           │   ├── dynamic-agent-factory.ts # [v2.5.0] 动态 Agent 实例工厂（按节点创建 scoped Agent）
│           │   ├── context-db.ts           # [v2.5.0] 四层上下文数据库（SYS/L0/L1/L2）
│           │   ├── repo-isolation.ts       # [v2.4.0] Run 级仓库隔离（Git worktree 池化）
│           │   ├── skill-materialization.ts # [v2.4.0] Skill 物化（白名单校验 + TTL 缓存）
│           │   ├── permission-isolation.ts  # [v2.4.0] Agent 权限隔离（RBAC + glob 文件访问控制）
│           │   ├── a2a-protocol.ts         # [v2.4.0] A2A 通信协议（优先级收件箱 + ACK 确认）
│           │   ├── contract-validator.ts   # [v2.4.0] OutputContract 验证引擎
│           │   ├── robustness.ts           # [v2.4.0] 健壮性服务（重试/死信队列/Checkpoint/审计）
│           │   ├── artifact-merge.ts      # [v2.6.0] 产出物闭环（Git worktree Diff Review + Merge/Discard）
│           │   ├── metrics-collector.ts   # [v2.6.0] 可观测性指标采集（时间/Token/质量评分）
│           │   ├── feedback-collector.ts  # [v2.7.0] 反馈采集器（审批打回/Discard/失败 自动记录）
│           │   ├── weekly-digest.ts       # [v2.7.0] 周报摘要生成器（汇总指标+反馈→Markdown）
│           │   ├── sync.ts               # [v2.7.1] GitHub Private Repo 数据同步服务
│           │   └── skill-extraction.ts   # [v2.8.6] Skill 自动沉淀（评分引擎+去重+持久化）
│           └── types/
│               └── index.ts   # 核心类型定义（含 NodeContext、EdgeCondition、A2A、RBAC 等）
├── .agent-flow/
│   └── context/         # 项目上下文文档（本目录）
├── docs/
│   ├── SYSTEM-INTRODUCTION.md  # 系统介绍文档
│   └── USER-MANUAL.md          # 用户手册
├── scripts/
│   └── sync-context.ts  # Context 同步检查脚本
├── package.json         # Monorepo 根配置
├── tsconfig.json        # TypeScript 根配置
└── eslint.config.js     # ESLint 配置
```

## 技术栈

### 前端 (packages/client)

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19 | UI 框架 |
| TypeScript | 6 | 类型安全 |
| Vite | 8 | 构建工具 + Dev Server + HMR |
| Tailwind CSS | v4 | 样式（`@tailwindcss/vite` 插件） |
| Ant Design | 6 | 组件库 |
| Zustand | 5 | 状态管理（仅业务数据） |
| React Router Dom | 7 | 路由（URL 驱动状态） |

### 后端 (packages/server)

| 技术 | 版本 | 用途 |
|------|------|------|
| Express | 5 | HTTP 框架 |
| ws | - | WebSocket 实时通信 |
| tsx | - | TypeScript 直接运行 + watch 热更新 |
| Vitest | latest | 单元测试框架 |
| Node.js | 20+ | 运行时（Vite 8 强制要求） |

### 数据持久化

- **SQLite + WAL** [v2.7.3]：项目、模板、Run、Node、Turn 等核心数据迁移到 SQLite 数据库（`~/.agent-flow/data.db`），WAL 模式支持并发读写
- 认证信息：`~/.agent-flow/auth.json`
- 同步配置：`~/.agent-flow/sync-config.json`
- Skill 沉淀：`project.path/.agent-flow/skills/<name>/SKILL.md` [v2.8.6]
- 日志：localStorage（前端，最近 200 条）

### 数据同步（GitHub Private Repo）[v2.7.1]

- 同步仓库：用户 GitHub 账号下的私有仓库（如 `agent-flow-data`）
- 同步范围：projects.json、templates.json、runs/（元数据）、context-db/（项目上下文）
- 不同步：auth.json（敏感）、sync-config.json（设备本地）、Run 完整输出日志（体积过大）
- 同步机制：GitHub Contents API（无需本地 git CLI）
- 冲突策略：LWW（Last Write Wins，以时间戳较新为准）
- 触发时机：系统启动时自动 pull、关键写操作后防抖 push、手动触发

## 核心架构原理

### 三层状态机

```
Run（工作流实例）
  └── Node（任务节点）
       └── Turn（Agent 执行轮次）
```

每层独立状态流转：
- **Run**: created → running → completed / failed
- **Node**: pending → ready → running → wait_user_review → completed / skipped / failed
- **Turn**: idle → running → completed / error / paused

### DAG 编排引擎

基于有向无环图的任务编排，节点间通过 edges 定义依赖关系。当一个节点的所有前置依赖完成后，该节点自动进入 ready 状态。

v2.3.0 新增条件分支：EdgeCondition 支持 status / output_contains / expression 三种模式，computeReadyNodes 自动跳过条件不满足的边。

### Context Chaining（节点上下文传递）

v2.3.0 引入的核心机制。每个节点执行前，引擎调用 `buildNodeContext()` 自动聚合所有前置节点的产出：

```typescript
interface NodeContext {
  predecessorOutputs: PredecessorOutput[]  // 前置节点的 Turn 输出摘要 + Artifacts
  variables?: Record<string, string>       // 模板变量
}
```

好处：后续节点无需手动指定输入来源，DAG 拓扑自动决定上下文来源。Planner 的需求分析输出自动流向 Designer，Designer 的方案自动流向 Executor，形成完整的信息链条。

### OutputContracts（产出物合同）

每个模板节点定义 `outputContracts` 声明该节点应该产出什么：

```typescript
interface OutputContract {
  id: string
  title: string
  category: 'document' | 'code' | 'config' | 'test' | 'report'
  format: string      // markdown / json / typescript 等
  required: boolean   // 是否必须产出
}
```

用于 Agent 输出结构化解析时的匹配校验——Agent 完成后自动提取产出物与合同比对。

### 多角色 Agent 系统

- **Planner（规划者）**: 拆解需求为可执行任务
- **Manager（管理者）**: 协调资源、分配节点
- **Executor（执行者）**: 调用 CLI 工具编写代码

Agent 通过 CLI 进程方式调用（codex-cli / claude-cli），非阻塞异步执行，WebSocket 实时推送输出流。

### Per-Project Agent 配置 [v2.5.0]

支持按项目维度启用/禁用特定 Agent，解决用户不一定拥有所有 Provider API Key 的问题：

- **数据模型**：`Project.enabledAgentIds?: string[]`，undefined 表示全部启用（向后兼容）
- **Server API**：`GET/PUT /api/projects/:id/enabled-agents`
- **前端配置组件**：AgentsPanel 中的 `ProjectAgentConfig`，Switch 开关逐个控制
- **DAG 节点过滤**：RunDetail 根据当前项目的 `enabledAgentIds` 过滤 agents 列表，仅展示已启用的 Agent
- **Store 同步**：保存后立即更新全局 Zustand Store，确保其他组件即时获得最新状态

### 工作流模板

4 个内置模板，每个都包含完整的节点链和 deliver（交付汇总）节点：

| 模板 ID | 名称 | 节点链 |
|---------|------|--------|
| sdd-standard | 标准 SDD 开发流程 | specify → design → task → implement → review → deliver |
| quick-feature | 快速功能迭代 | specify → implement → test → deliver |
| bug-fix | Bug 修复流程 | specify → implement → test → deliver |
| parallel-dev | 前后端并行开发 | specify → [implement-fe ∥ implement-be] → test → deliver |

### 路由架构

```
/                                → 首页（欢迎页）
/projects/:projectId             → 重定向到 /projects/:projectId/runs
/projects/:projectId/:tab        → 项目详情（runs | workflow | skills | agents | settings）
/projects/:projectId/runs/:runId → Run 详情页（DAG 视图 + 节点执行）
/changelog                       → 更新日志
/about                           → 项目介绍
```

设计原则：URL 即状态，刷新/分享链接可完整恢复视图。

### Repo Isolation（仓库隔离）[v2.4.0]

每个 Run 拥有独立的仓库工作目录，防止多个并行 Run 之间的文件冲突。核心机制：

- **仓库池（RepoPool）**：全局仓库池管理，按 `repoUrl` 聚合，每个仓库维护最大 `maxWorktrees` 个 Git worktree
- **工作空间创建策略**：优先 Git worktree（轻量），fallback 到 symlink 或 copy
- **生命周期管理**：Run 结束后自动回收 worktree，`dispose()` 时清理所有临时目录

API：`POST /api/repo-pool/workspace` 创建工作空间，`GET /api/repo-pool/status` 查看池状态

### Skill Materialization（Skill 物化）[v2.4.0]

Agent 执行时，系统根据白名单/黑名单策略将 Skill 文件物化（复制）到 Agent 工作目录：

- **白名单模式**：`SkillWhitelist` 按 agentRole 或 nodeType 声明允许使用的 Skill patterns
- **物化流程**：`materializeForNode(nodeId)` 读取 Skill 源文件，复制到节点工作目录 `.skills/` 下
- **TTL 缓存**：物化结果带 TTL 缓存，相同配置在 TTL 内直接复用
- **Prompt 注入**：`formatSkillsAsPrompt()` 将物化后的 Skill 列表格式化为 Agent system prompt 的一部分

API：`POST /api/skills/materialize/:nodeId` 触发物化

### Permission Isolation（权限隔离）[v2.4.0]

基于 RBAC 的 Agent 粒度权限控制，限制 Agent 对仓库和文件的访问范围：

- **策略模型**：`AgentPermissionPolicy` 按 agentRole 定义 `allowedRepos`（glob）和 `fileAccessRules`（glob + read/write/execute）
- **双层校验**：`checkRepoAccess()` 仓库级 → `checkFileAccess()` 文件级
- **审计日志**：每次权限检查结果（allow/deny）记录到内存审计日志，含时间戳和操作上下文
- **安全默认**：无匹配策略时默认拒绝（deny-by-default）

API：`POST /api/permissions/check` 校验权限，`GET /api/permissions/audit-log` 查看审计日志

### A2A Inbox Protocol（Agent 间通信）[v2.4.0]

运行时 Agent 间的异步消息通信协议，支持任务委派和结果回传：

- **消息类型**：`request`（请求）、`response`（响应）、`delegate`（委派）、`broadcast`（广播）
- **优先级队列**：每个 Agent 维护一个按优先级排序的收件箱（high > normal > low）
- **ACK 机制**：接收方确认消息已读，发送方可追踪消息状态（pending → delivered → read → resolved）
- **Channel 管理**：逻辑通道用于消息分组，支持自动过期清理
- **Legacy Bridge**：兼容原有 InboxItem 格式，新旧系统平滑过渡

API：`POST /api/a2a/send`、`POST /api/a2a/delegate`、`GET /api/a2a/inbox/:agentId`、`POST /api/a2a/ack`

### A2A 前端可视化面板 [v2.5.0]

前端 A2APanel 组件（`packages/client/src/components/detail/A2APanel.tsx`）提供三种视图展示 Agent 间消息流转：

- **拓扑图视图**：纯 SVG 实现的环形布局 Agent 网络图，节点按角色着色，连线粗细反映消息量，通信链路列表展示消息类型标签
- **时间线视图**：按时间倒序消息列表，支持类型/优先级筛选，可展开查看 payload
- **统计视图**：量化指标卡片 + 类型分布柱状图 + 优先级分布 + Agent 活跃度排行

前端 API 封装：`a2aApi` 对象（getMessages / getStats / getInbox / send / delegate / acknowledge / resolve / createChannel）

### ArtifactMergeService（产出物闭环）[v2.6.0]

基于 Git worktree 的产出物 Diff Review + Merge/Discard 完整闭环，实现类 GitHub PR 的代码审查体验：

- **Diff Review 准备**：`prepareDiffReview(runId)` 在 Git worktree 环境执行 `git diff`，解析 unified diff 为结构化 `FileDiff[]`（含 DiffHunk、DiffLine 精细到行级别）
- **合并策略**：`mergeBranch(runId, strategy)` 支持 squash / merge / rebase 三种合并方式
- **丢弃分支**：`discardBranch(runId)` 清理 worktree 并删除分支
- **单文件 Diff**：`getFileDiff(runId, filePath)` 获取指定文件的增量变更

前端 DiffReviewPanel 组件（`packages/client/src/components/detail/DiffReviewPanel.tsx`）：
- GitHub PR 风格文件树 + 行级 Diff 展示（添加绿色 / 删除红色 / 上下文灰色）
- Hunk 折叠/展开、文件级统计（+N / -N）
- 合并策略选择器（Squash / Merge Commit / Rebase）
- Approve（合并）和 Discard（丢弃）操作按钮

API 路由：`GET /api/diff-review/:runId`、`POST /api/diff-review/:runId/merge`、`POST /api/diff-review/:runId/discard`、`GET /api/diff-review/:runId/file-diff`

### MetricsCollector（可观测性增强）[v2.6.0]

全流程指标采集与效率评估系统，提供运行时可视化：

- **时间指标**：记录每个节点的 startTime / reviewTime（首次审批耗时）/ rejectTime（打回次数与时间） / totalDuration
- **Token 指标**：按节点/Agent/角色维度追踪 Token 消耗分布
- **质量指标**：基于打回率、首次通过率、总 Token 效率计算综合质量评分
- **Timeline 数据**：构建甘特图数据（节点时间跨度 + 并行度分析）
- **效率评分**：自动计算 efficiency score（加权 duration / token / quality）
- **持久化**：指标数据持久化到 `~/.agent-flow/metrics/metrics.json`

前端 MetricsPanel 组件（`packages/client/src/components/detail/MetricsPanel.tsx`）提供四个子 Tab：
- **Overview**：6 张指标卡片（总耗时、总 Token、平均节点耗时、首次通过率、打回率、效率评分）
- **Timeline**：Gantt 甘特图展示各节点时间跨度和并行执行情况
- **Token Distribution**：水平柱状图展示各节点/Agent Token 消耗占比
- **Efficiency**：排序表格展示各节点效率评分 + 进度条可视化

API 路由：`GET /api/metrics/:runId`、`GET /api/metrics/:runId/token-distribution`、`GET /api/metrics/:runId/efficiency`、`GET /api/metrics/:runId/trend`

前端 API 封装：`diffReviewApi` 对象（getDiffReview / mergeBranch / discardBranch / getFileDiff）+ `metricsApi` 对象（getMetrics / getTokenDistribution / getEfficiency / getTrend）

### Contract Validation（合同验证引擎）[v2.4.0]

节点完成时自动校验 Agent 产出物是否满足 OutputContract 定义：

- **匹配规则**：按 `category` 精确匹配 + `format` 兼容性评估（如 typescript 兼容 code 类 format）
- **验证报告**：返回 `ContractValidationResult`，包含匹配项、缺失项、多余项、总体 pass/fail
- **格式兼容矩阵**：内置常见格式的兼容关系映射

API：`POST /api/contracts/validate/:nodeId`

### Robustness（健壮性服务）[v2.4.0]

为工作流执行提供容错和可观测能力：

- **指数退避重试**：`RetryPolicy` 配置最大重试次数、基础延迟、退避因子、可重试错误类型
- **死信队列（DLQ）**：超过重试上限的失败任务进入 DLQ，保留原始上下文和失败原因
- **Checkpoint 快照**：在关键时刻保存 Run/Node/Agent 状态快照，支持故障恢复
- **审计日志**：所有操作（node_start、agent_spawn、retry、dlq_enqueue 等）带时间戳记录，支持导出

API：`POST /api/robustness/retry`、`GET /api/robustness/dlq`、`POST /api/robustness/checkpoint`、`GET /api/robustness/health`

### Skill 物化执行链路（完整接入）[v2.8.5]

v2.4.0 的 SkillMaterializationService 在 v2.8.5 正式接入执行链路，Skill 内容真正参与 Agent prompt 组装：

- **DynamicAgentFactory 接入**：`assembleScopedContext()` 第 7 步读取节点 `skillIds`，调用 `SkillMaterializationService.initWhitelistFromTemplate()` 设置白名单，`getSkillPromptForNode()` 物化 Skill 文件内容生成 prompt 片段
- **Prompt 注入层级**：`buildFullPrompt()` 第 5.5 步（前置产出物之后、L2 节点指令之前）注入 `skillPrompt`
- **节点 Skill 绑定 API**：`PATCH /api/runs/:runId/nodes/:nodeId/skills` 支持动态更新节点 Skill 绑定并即时持久化
- **前端 UI**：NodeSkillBinding 组件改为 Select 多选下拉框（搜索过滤 + 乐观更新 + 失败回滚）

类型扩展：`ScopedContext` 接口新增 `skillPrompt?: string` 字段。

### Skill 自动沉淀系统 [v2.8.6]

节点执行完成后自动评估产出物价值并择优沉淀为可复用 Skill 文件：

- **SkillExtractionService**（419行）：核心服务，包含评分引擎、去重检测、持久化逻辑
- **百分制 5 维评分引擎**：节点类型权重（0~30）+ 内容长度（0~15）+ Markdown 结构化（0~20）+ 代码块密度（0~15）+ 关键词匹配（0~20），满分 100 转 0~1 置信度，阈值 0.6
- **Jaccard 去重**：词集相似度 >0.7 视为重复自动跳过
- **存储路径**：`project.path/.agent-flow/skills/<skill-name>/SKILL.md`，含 YAML frontmatter
- **事件驱动**：`run:node_updated` status=completed 异步触发，不阻塞主流程
- **双模式**：自动沉淀（评分达标）+ 手动沉淀（`forceExtract()` 置信度 1.0）

API 路由：`GET /skills/extraction-stats`、`GET /skills/extraction-log`、`POST /skills/extract`、`GET /skills/project-dir/:projectId`

### 产出物体系优化（全链路闭环）[v2.8.7]

解决"Agent 不知道如何标记产出物"导致解析噪音的问题，建立"引导产出 → 精准解析 → 分类展示"三段闭环：

- **后端 Prompt 格式引导**：`AgentService.getArtifactFormatGuidance()` 在 `buildContextualPrompt()` 末尾追加格式规范，引导 Agent 使用 ` ```lang:filename` 标记代码、`## 标题` 标记文档
- **模板层交付物声明**：4 个模板 20 个节点 prompt 末尾追加"你必须产出以下交付物"列表，与 `outputContracts` 一一对应
- **前端分类展示**：`ArtifactItem` 组件按 category 差异化展示（code 蓝/document 绿/test 紫/report 橙/config 灰），支持展开/折叠内容预览（代码 SyntaxHighlighter 高亮，文档文本预览）

产出物 5 大功能联动点：
1. **节点间上下文传递**：`buildContextualPrompt()` 将前置节点 artifacts 注入后续节点 prompt
2. **准入条件门控**：`computeReadyNodes()` 检查前置节点是否产出 required artifacts
3. **合同验证**：`ContractValidator` 校验实际产出与 `outputContracts` 声明是否匹配
4. **Skill 自动沉淀**：`SkillExtractionService` 从高价值 artifacts 提取可复用 Skill
5. **Diff Review / Git 合入**：`ArtifactMergeService` 基于代码类 artifacts 生成 PR

### 安全机制

- **文件系统**: allowedRoots 白名单，路径穿越防护（规范化 + 前缀匹配）
- **OAuth**: state 参数 CSRF 防护（随机值 + 10 分钟 TTL 自动过期）
- **WebSocket**: ManagedWS dispose 标志位防止内存泄漏递归重连
- **Agent 取消**: cancelledTurns Set 防止 close handler 重复提交状态
- **持久化**: 所有状态变更方法 async/await persist() 确保数据不丢失
- **启动恢复**: 自动重置孤儿 running 节点（服务器重启后进程已丢失）
- **权限隔离**: [v2.4.0] RBAC deny-by-default + glob 文件访问规则
- **仓库隔离**: [v2.4.0] Git worktree 池化防止并行 Run 文件冲突
- **Agent 可见性控制**: [v2.5.0] 项目级 Agent 启用/禁用，限制用户只能使用已配置的 Agent
- **产出物闭环**: [v2.6.0] Git worktree Diff Review + 三种合并策略，代码变更可审可控
- **可观测性**: [v2.6.0] 全链路指标采集 + 持久化，运行效率可量化可追溯
- **数据同步**: [v2.7.1] GitHub Private Repo 同步，多设备数据互通，Context DB 知识资产不丢失
- **SQLite + WAL**: [v2.7.3] 持久化迁移到 SQLite，WAL 模式并发读写安全
- **Skill 白名单隔离**: [v2.8.5] 节点只能使用显式绑定的 Skills，避免信息过载
- **产出物格式引导**: [v2.8.7] Prompt 引导 Agent 规范输出格式，降低解析误识别

## 运行方式

```bash
# 需要 Node.js 20+（Vite 8 要求）
nvm use --delete-prefix v20.19.2

# 安装依赖
npm install

# 启动开发环境（前后端并行）
npm run dev
# → 前端: http://localhost:5173/agent-flow/
# → 后端: http://localhost:3001/api
# → WebSocket: ws://localhost:3001/ws

# 生产构建 & 部署 GitHub Pages
cd packages/client && npx vite build
npm run deploy  # gh-pages 推送到 GitHub Pages
```

## 环境变量（可选）

```bash
# GitHub OAuth（用于登录功能）
GITHUB_CLIENT_ID=your_id
GITHUB_CLIENT_SECRET=your_secret

# 文件系统安全（逗号分隔的允许访问目录）
ALLOWED_FILE_ROOTS=/path/to/project1,/path/to/project2
```
