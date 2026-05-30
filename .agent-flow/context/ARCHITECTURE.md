# AgentFlow 项目架构

> 最后更新：2026-05-31（v2.4.1）  
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
│   │   │   │   ├── detail/    # 项目详情面板（Runs/Workflow/Skills/Agents/Settings）
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
│       ├── tests/         # Vitest 单元测试（68 cases）
│       │   ├── workflow-engine.test.ts
│       │   ├── a2a-protocol.test.ts
│       │   └── contract-validator.test.ts
│       └── src/
│           ├── index.ts       # 服务入口（v2.4.0）
│           ├── routes/
│           │   └── api.ts     # REST API 路由定义（全部 async/await）
│           ├── services/      # 业务服务层
│           │   ├── project.ts       # 项目 CRUD
│           │   ├── template.ts      # 工作流模板管理（4 个内置模板，含 deliver 节点）
│           │   ├── workflow-engine.ts # DAG 工作流引擎（三层状态机 + Context Chaining）
│           │   ├── agent.ts         # Agent 调度（Codex/Claude CLI）
│           │   ├── auth.ts          # GitHub OAuth 认证（含 CSRF state 校验）
│           │   ├── skill.ts         # Skills 扫描与管理
│           │   ├── filesystem.ts    # 文件系统操作（allowedRoots 安全校验）
│           │   ├── git.ts           # Git 集成（状态/commit/diff）
│           │   ├── terminal.ts      # 终端进程管理
│           │   ├── repo-isolation.ts       # [v2.4.0] Run 级仓库隔离（Git worktree 池化）
│           │   ├── skill-materialization.ts # [v2.4.0] Skill 物化（白名单校验 + TTL 缓存）
│           │   ├── permission-isolation.ts  # [v2.4.0] Agent 权限隔离（RBAC + glob 文件访问控制）
│           │   ├── a2a-protocol.ts         # [v2.4.0] A2A 通信协议（优先级收件箱 + ACK 确认）
│           │   ├── contract-validator.ts   # [v2.4.0] OutputContract 验证引擎
│           │   └── robustness.ts           # [v2.4.0] 健壮性服务（重试/死信队列/Checkpoint/审计）
│           └── types/
│               └── index.ts   # 核心类型定义（含 NodeContext、EdgeCondition、A2A、RBAC 等）
├── .agent-flow/
│   └── context/         # 项目上下文文档（本目录）
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

- 项目数据：`~/.agent-flow/projects.json`
- 工作流模板：`~/.agent-flow/templates.json`
- Run 历史：`~/.agent-flow/runs/index.json`
- 认证信息：`~/.agent-flow/auth.json`
- 日志：localStorage（前端，最近 200 条）

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

### 安全机制

- **文件系统**: allowedRoots 白名单，路径穿越防护（规范化 + 前缀匹配）
- **OAuth**: state 参数 CSRF 防护（随机值 + 10 分钟 TTL 自动过期）
- **WebSocket**: ManagedWS dispose 标志位防止内存泄漏递归重连
- **Agent 取消**: cancelledTurns Set 防止 close handler 重复提交状态
- **持久化**: 所有状态变更方法 async/await persist() 确保数据不丢失
- **启动恢复**: 自动重置孤儿 running 节点（服务器重启后进程已丢失）
- **权限隔离**: [v2.4.0] RBAC deny-by-default + glob 文件访问规则
- **仓库隔离**: [v2.4.0] Git worktree 池化防止并行 Run 文件冲突

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
