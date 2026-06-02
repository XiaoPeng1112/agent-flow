# AgentFlow 系统深度技术分析

> 面向深入学习和后续优化的技术参考文档  
> 版本：v2.0 | 日期：2026-06-02 | 重构后更新

---

## 一、术语表（Glossary）

在阅读本文档或系统源码之前，建议先熟悉以下核心概念。它们按照"从外到内"的顺序排列，先理解宏观概念再深入技术细节。

### 1.1 架构与流程类

| 术语 | 英文 | 含义 |
|------|------|------|
| MAF | Multi-Agent Flow | 本系统的核心架构理念——多个 AI Agent 按照预定义的流程图协作完成复杂任务 |
| DAG | Directed Acyclic Graph | 有向无环图。工作流中的任务节点通过有向边连接，且不允许出现环路（即不能循环依赖）。每个节点代表一个执行步骤，边代表依赖关系："A → B"意味着 B 必须等 A 完成后才能执行 |
| 拓扑排序 | Topological Sort | 将 DAG 中的节点按依赖关系排成线性序列的算法。确保每个节点执行时，其所有前驱节点已经完成 |
| 编排 | Orchestration | 由一个中心化的引擎（WorkflowEngine）统一协调各 Agent 的执行顺序和数据传递，区别于"编舞"（Choreography，各服务自行协调） |
| 人在回路 | Human-in-the-Loop | 关键环节需要人类审核确认后才能推进。在本系统中体现为节点完成后进入 `wait_user_review` 状态，用户验收通过后才真正标记为 completed |

### 1.2 状态机与数据模型类

| 术语 | 英文 | 含义 |
|------|------|------|
| Run | — | 一次工作流的完整执行实例。包含若干 TaskNode，记录整体进度、耗时、Token 消耗等指标。类比：一次 CI/CD Pipeline 的执行 |
| TaskNode | — | DAG 中的单个节点/任务。有自己的状态机（pending → ready → running → wait_user_review → completed/failed/skipped）。类比：Pipeline 中的一个 Stage |
| AgentTurn | — | Agent 在某个 TaskNode 上的一次执行回合。一个节点可能有多次 Turn（如失败重试、人工要求重做）。记录了具体的 prompt、输出、耗时、token 数 |
| DAGEdge | — | 连接两个 TaskNode 的有向边，定义了"from 节点必须在 to 节点之前完成"的依赖关系 |
| Artifact | — | Agent 执行过程中产出的文件或数据块（如生成的代码文件、测试报告等）。存储在 Turn 级别，支持后续节点引用 |
| Checkpoint | — | Run 的某个时刻的完整快照。用于灾难恢复——如果后续执行出错，可以回滚到某个 Checkpoint 重新开始 |

### 1.3 Agent 相关

| 术语 | 英文 | 含义 |
|------|------|------|
| Agent | — | 一个可执行任务的 AI 实体。在本系统中，Agent 通过调用 CLI 工具（如 `codex`、`claude` 命令行）来完成任务 |
| LLM 模式 | LLM Mode | 调用真实的大语言模型 CLI 执行任务。适用于需要推理、创造力的场景（如代码生成、方案设计） |
| DET 模式 | Deterministic Mode | 执行预定义的确定性脚本，不涉及 LLM 调用。适用于固定逻辑的任务（如格式检查、文件复制） |
| HYB 模式 | Hybrid Mode | 混合模式——先尝试确定性脚本执行，若失败则回退到 LLM 模式。兼顾效率和灵活性 |
| DynamicAgentInstance | — | 为每个 TaskNode 动态创建的 Agent 运行时实例。携带了该节点专属的上下文（ScopedContext），使同一个 Agent 配置在不同节点上表现不同 |
| Agent Pool | — | 系统预注册的 Agent 集合。当前为 10 个：5 个 Codex 实例 + 5 个 Claude 实例，通过命名区分（如 `codex-alpha`、`claude-beta`） |

### 1.4 上下文与知识管理

| 术语 | 英文 | 含义 |
|------|------|------|
| ContextDB | — | 四层分级的知识存储系统。为 Agent 提供执行时所需的背景信息，按作用域从大到小分为 SYS → L0 → L1 → L2 四层 |
| SYS 层 | System Layer | 系统级上下文，对所有项目/节点生效。如"所有代码必须使用 TypeScript" |
| L0 层 | Global Layer | 全局层，跨项目生效的通用知识。如编码规范、团队约定 |
| L1 层 | Project Layer | 项目层，特定项目的上下文。如项目的技术栈选择、架构决策 |
| L2 层 | Node Layer | 节点层，特定任务节点的专属上下文。如"这个节点负责的模块的具体接口定义" |
| ScopedContext | — | DynamicAgentFactory 为每个节点组装的完整上下文包，包含：角色定义 + 前驱节点输出 + ContextDB 各层合并结果 + 项目元数据 |
| Context Chaining | — | 上下文链式传递——前驱节点的输出（Artifact + Turn 摘要）自动注入到后继节点的 ScopedContext 中，让下游 Agent 知道上游做了什么 |

### 1.5 同步与持久化

| 术语 | 英文 | 含义 |
|------|------|------|
| GitHub Contents API | — | GitHub 提供的 REST API，可以读写仓库中的文件内容，无需本地安装 git 客户端。本系统用它实现数据的远程同步 |
| LWW | Last Write Wins | 最后写入胜出——冲突解决策略。当两端同时修改了同一数据，取时间戳更晚的版本。简单但可能丢失先写入端的修改 |
| `_turns` 嵌入 | — | 一种"逻辑分离、物理合并"的存储技巧。Turns 在内存中独立存储（便于高频读写），但 push 到 GitHub 时临时嵌入到 Run JSON 的 `_turns` 字段中（减少 API 调用），pull 时再提取还原 |
| 多用户隔离 | Multi-user Isolation | GitHub 仓库中按 `users/{github_login}/` 路径隔离各用户数据，互不干扰 |
| gitRemote 匹配 | — | 通过项目的 git remote URL（如 `git@github.com:user/repo.git`）在不同设备间识别"同一个项目"，解决跨设备路径不同的问题 |

### 1.6 通信与容错

| 术语 | 英文 | 含义 |
|------|------|------|
| A2A Protocol | Agent-to-Agent Protocol | Agent 间的结构化通信协议。支持消息发送、ACK 确认、优先级队列、TTL 过期等，用于 Manager Agent 委派任务给 Executor Agent 等场景 |
| Inbox | — | 每个 Agent 的消息收件箱。新的 A2A 消息到达后进入收件箱等待处理 |
| DLQ | Dead Letter Queue | 死信队列。重试次数耗尽仍失败的任务/消息进入 DLQ，等待人工介入处理 |
| 指数退避 | Exponential Backoff | 重试间隔按指数增长（如 5s → 10s → 20s → 40s...），避免在下游服务恢复前频繁重试造成雪崩 |
| WAL | Write-Ahead Log | 预写日志。SQLite WAL 模式下，写入操作先记录到 `-wal` 文件，读操作从主库 + WAL 合并查询。即使进程崩溃，重启后 SQLite 自动 replay WAL 恢复完整状态。**已在 v2.0 重构中实现** |
| StorageSQLite | — | 系统的持久化层实现，基于 better-sqlite3（同步 API） + WAL 模式。单个 `.db` 文件，零额外服务，表结构：runs / nodes / edges / turns / artifacts / inbox |

### 1.7 客户端相关

| 术语 | 英文 | 含义 |
|------|------|------|
| Zustand | — | 轻量级 React 状态管理库，类似 Redux 但 API 更简洁。本系统用它管理全局 state（projects、runs、agents 等） |
| WebSocket | — | 全双工通信协议。服务端状态变更（如节点状态更新、Turn 完成）通过 WS 实时推送到前端，无需轮询 |
| Lazy Loading | — | 路由组件按需加载。用户访问某个页面时才下载对应的 JS bundle，减少首屏加载时间 |
| 乐观 UI | Optimistic UI | 前端收到 WS 推送后直接更新 UI，不等待 HTTP 响应确认。让用户感知到即时反馈 |

---

## 二、系统架构深度剖析

### 2.1 整体架构图

```
┌────────────────────────────────────────────────────────────────────┐
│                          Client Layer                               │
│                                                                    │
│   React 18 + Ant Design + Zustand + React Router (lazy loading)    │
│   WebSocket 实时连接（自动重连 3s）                                   │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│                        Transport Layer                              │
│                                                                    │
│   REST API (Express, 70+ endpoints)  │  WebSocket (ws library)     │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│                        Service Layer                                │
│                                                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ WorkflowEngine  │  │  AgentService   │  │   SyncService    │  │
│  │ (状态机+DAG调度) │  │ (CLI调度+Token) │  │ (GitHub同步)     │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬─────────┘  │
│           │                    │                     │             │
│  ┌────────┴────────┐  ┌───────┴─────────┐  ┌───────┴─────────┐  │
│  │  A2AProtocol    │  │ DynamicAgent    │  │  Robustness     │  │
│  │  (Agent间通信)   │  │ Factory         │  │  Service        │  │
│  └─────────────────┘  │ (实例化+上下文)  │  │ (重试+DLQ+审计) │  │
│                        └───────┬─────────┘  └─────────────────┘  │
│                                │                                   │
│                        ┌───────┴─────────┐                        │
│                        │   ContextDB     │                        │
│                        │  (四层知识库)    │                        │
│                        └─────────────────┘                        │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│                        Storage Layer                                │
│                                                                    │
│   本地: ~/.agent-flow/data/agent-flow.db (SQLite + WAL 模式)       │
│         内存 Map 缓存（启动时从 SQLite 加载）                        │
│   远程: GitHub Repository (via Contents API)                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流详解

一个典型的工作流执行过程中，数据按以下路径流动：

```
用户创建 Run
    │
    ▼
WorkflowEngine.createRun()
    │  初始化所有 TaskNode 为 pending
    │  计算 DAG 入口节点（无前驱的节点）→ 标记为 ready
    ▼
用户点击"执行" / 自动调度
    │
    ▼
WorkflowEngine.executeNode(nodeId)
    │  节点状态: ready → running
    │  创建新的 AgentTurn
    ▼
DynamicAgentFactory.createInstance(node, run)
    │  组装 ScopedContext:
    │    - 角色定义 (planner/manager/executor)
    │    - 前驱节点输出 (Context Chaining)
    │    - ContextDB 四层合并 (SYS → L0 → L1 → L2)
    │    - 项目元数据
    ▼
AgentService.execute(agentId, scopedContext)
    │  检测 CLI 可用性
    │  spawn 子进程（timeout: 10min）
    │  实时收集 stdout/stderr
    ▼
执行完成
    │  解析 Token 用量
    │  提取 Artifact（文件路径）
    │  Turn 状态: running → completed/failed
    ▼
WorkflowEngine 更新节点状态
    │  节点状态: running → wait_user_review
    │  WebSocket 广播状态变更
    ▼
用户审核 (Human-in-the-Loop)
    │  approve → completed
    │  reject  → failed (可重试)
    ▼
WorkflowEngine.computeReadyNodes()
    │  扫描所有 pending 节点
    │  检查前驱是否全部 completed
    │  符合条件的 → ready
    ▼
下一批节点开始执行...（循环直到所有节点完成或失败）
    │
    ▼
Run 状态: running → completed/failed
    │
    ▼
SyncService 自动同步到 GitHub（5s debounce）
```

### 2.3 三层状态机详解

系统的执行控制通过三层嵌套的状态机实现，每层管理不同粒度的执行状态：

**第一层：Run 状态机**

```
idle ──────► running ──────► completed
                │                 ▲
                │                 │ (所有节点完成)
                ▼                 │
              paused ─────► running
                │
                ▼
              failed
```

Run 是最粗粒度的状态。`idle` 表示已创建但未开始执行，`running` 表示至少有一个节点正在执行，`paused` 表示用户主动暂停（不再自动调度新节点），`completed` 表示所有节点执行完毕，`failed` 表示出现了不可恢复的错误。

**第二层：TaskNode 状态机**

```
pending ──► ready ──► running ──► wait_user_review ──► completed
              ▲         │                │                  │
              │         ▼                ▼                  │
              │       failed ◄──── (rejected)               │
              │         │                                   │
              │         ▼                                   │
              │       skipped                               │
              │                                             │
              └─────────────────────────────────────────────┘
                        (下游节点触发 ready)
```

这是最核心的状态机。关键的状态转换规则：

- `pending → ready`：所有前驱节点都已 `completed`（由 `computeReadyNodes()` 判断）
- `ready → running`：Agent 开始执行
- `running → wait_user_review`：Agent 执行完成，等待人类审核
- `wait_user_review → completed`：人类审核通过
- `wait_user_review → failed`（rejected）：人类审核不通过，可选择重试
- 任何状态 → `skipped`：用户手动跳过该节点

**第三层：AgentTurn 状态机**

```
created ──► running ──► completed
                │
                ▼
              failed ──► (触发重试 → 新 Turn)
```

Turn 是最细粒度的状态。一个 TaskNode 可能经历多次 Turn（首次执行失败后重试，或用户 reject 后要求重做）。每次 Turn 独立记录 prompt、输出、耗时、token 消耗，便于事后分析。

### 2.4 服务间依赖关系

```
                    ┌──────────────────┐
                    │    api.ts        │  ← 入口，路由分发
                    │  (70+ endpoints) │
                    └────────┬─────────┘
                             │ 调用
          ┌──────────────────┼──────────────────────┐
          │                  │                      │
          ▼                  ▼                      ▼
┌─────────────────┐ ┌───────────────┐  ┌────────────────────┐
│ WorkflowEngine  │ │ AgentService  │  │   SyncService      │
│                 │ │               │  │                    │
│ 依赖:           │ │ 依赖:         │  │ 依赖:              │
│ - AgentService  │ │ - 无外部依赖  │  │ - WorkflowEngine   │
│ - Robustness   │ │               │  │ - GitHub API       │
│ - A2AProtocol  │ └───────┬───────┘  └────────────────────┘
└────────┬────────┘         │
         │                  │
         │           ┌──────┴───────────┐
         │           │ DynamicAgent     │
         │           │ Factory          │
         │           │                  │
         │           │ 依赖:            │
         │           │ - ContextDB      │
         │           │ - WorkflowEngine │
         │           └──────────────────┘
         │
    ┌────┴─────────────┐
    │  A2AProtocol     │
    │                  │
    │  依赖:           │
    │  - WorkflowEngine│ (桥接旧 Inbox)
    └──────────────────┘
```

注意：存在一些循环引用（WorkflowEngine ↔ A2AProtocol），通过构造函数注入 + 延迟初始化解决。

### 2.5 文件组织结构

```
agent-flow/
├── package.json              # Monorepo 根配置（workspaces）
├── packages/
│   ├── server/
│   │   ├── vitest.config.ts          # 测试配置
│   │   ├── tests/                    # 单元测试（122 个用例）
│   │   │   ├── workflow-engine.test.ts     # Facade 集成测试
│   │   │   ├── dag-scheduler.test.ts       # DAG 调度逻辑测试
│   │   │   ├── turn-manager.test.ts        # Turn 生命周期测试
│   │   │   ├── storage-sqlite.test.ts      # SQLite 存储层测试
│   │   │   ├── a2a-protocol.test.ts        # A2A 协议测试
│   │   │   └── contract-validator.test.ts  # 输出契约验证测试
│   │   └── src/
│   │       ├── index.ts              # 服务启动入口（Express + WS + 初始化）
│   │       ├── types/
│   │       │   └── index.ts          # 完整类型定义（630 行，所有接口/类型）
│   │       ├── services/
│   │       │   ├── workflow-engine.ts # Facade 门面（~250 行，委托给下方三模块）
│   │       │   ├── run-manager.ts    # Run CRUD/节点状态机/Artifact/Inbox（~565 行）
│   │       │   ├── dag-scheduler.ts  # DAG 拓扑排序/Ready 计算/条件边（~215 行）
│   │       │   ├── turn-manager.ts   # Turn 生命周期/Token 统计（~270 行）
│   │       │   ├── storage-sqlite.ts # SQLite + WAL 持久化层（~590 行）
│   │       │   ├── agent.ts          # Agent 调度与 CLI 执行（1012 行）
│   │       │   ├── sync.ts           # GitHub 同步（1149 行）
│   │       │   ├── dynamic-agent-factory.ts  # 动态 Agent 实例化（369 行）
│   │       │   ├── context-db.ts     # 四层上下文知识库（309 行）
│   │       │   ├── a2a-protocol.ts   # Agent 间通信协议（435 行）
│   │       │   └── robustness.ts     # 重试/DLQ/Checkpoint/审计（357 行）
│   │       └── routes/               # 按领域拆分的路由模块
│   │           ├── api.ts            # 路由协调器（~130 行，挂载子路由）
│   │           ├── auth.ts           # GitHub OAuth
│   │           ├── projects.ts       # 项目 + 模板
│   │           ├── runs.ts           # Run + Node 生命周期
│   │           ├── agents.ts         # Agent 执行 + 动态实例
│   │           ├── files.ts          # 文件读写 + Skill + 物化
│   │           ├── git.ts            # Git/Repo 隔离/权限/契约
│   │           ├── a2a.ts            # A2A 协议路由
│   │           ├── robustness.ts     # 健康检查/Checkpoint
│   │           ├── context.ts        # ContextDB 四层
│   │           ├── artifacts.ts      # Diff Review/Merge/Metrics
│   │           └── sync.ts           # GitHub 数据同步
│   │
│   └── client/
│       └── src/
│           ├── main.tsx              # 应用入口
│           ├── App.tsx               # 根组件
│           ├── router/index.tsx      # 路由定义（lazy loading）
│           ├── store/appStore.ts     # Zustand 全局状态（278 行）
│           ├── api/index.ts          # API 客户端 + WS 管理（577 行）
│           ├── components/
│           │   ├── detail/
│           │   │   ├── RunDetail.tsx        # 工作流详情页（1410 行）
│           │   │   ├── AgentTreePanel.tsx   # Agent 执行树面板
│           │   │   ├── CheckpointPanel.tsx  # 快照管理面板
│           │   │   ├── ContextDBPanel.tsx   # 上下文知识库面板
│           │   │   ├── A2APanel.tsx         # Agent 间通信面板
│           │   │   ├── DiffReviewPanel.tsx  # 代码 Diff 审查面板
│           │   │   └── MetricsPanel.tsx     # 指标统计面板
│           │   └── ...
│           └── types/index.ts        # 前端类型定义
│
└── docs/                             # 文档目录
    ├── SYSTEM-INTRODUCTION.md        # 系统介绍
    ├── USER-MANUAL.md                # 用户手册
    ├── NEW-MACHINE-SETUP.md          # 新机器配置指南
    └── DEEP-ANALYSIS.md             # 本文档
```

---

## 三、核心服务深度解析

### 3.1 WorkflowEngine 与三模块拆分（v2.0 重构）

**重构前：** WorkflowEngine 是一个 1068 行的 God Object，承担九大职责。

**重构后：** 采用 **Facade 模式** 拆分为四个文件，职责清晰，外部 API 零变更：

```
WorkflowEngine (Facade, ~250 行)
    │  对外保持完全相同的 API 签名
    │  内部委托给三个子模块
    │
    ├── RunManager (~565 行)
    │   ├── Run CRUD（创建、查询、删除、导入）
    │   ├── Run 状态机（created → running → paused → completed/failed）
    │   ├── 节点状态操作（启动、决策、批准、拒绝、跳过、重置、回滚）
    │   ├── Inbox 消息队列
    │   ├── Artifact 产出物管理
    │   ├── 持久化（委托 StorageSQLite）
    │   └── 事件广播
    │
    ├── DAGScheduler (~215 行)
    │   ├── 计算 Ready 节点（前置依赖完成检测）
    │   ├── 条件边（Conditional Edge）评估
    │   ├── Context Chaining（前驱产出物注入后继上下文）
    │   ├── DAG 拓扑排序（Kahn's Algorithm）
    │   └── 下游节点遍历（BFS）
    │
    └── TurnManager (~270 行)
        ├── Turn 启动 / 输出追加 / 结果记录 / 完成
        ├── Turn 查询（按节点、按活跃状态）
        └── Token 消耗统计与解析
```

**子模块间协作方式：** 通过 `inject()` 方法注入依赖（避免循环引用），由 Facade 构造函数统一完成注入：

```typescript
// WorkflowEngine 构造函数
constructor() {
  this.runManager = new RunManager()
  this.dagScheduler = new DAGScheduler()
  this.turnManager = new TurnManager()

  this.turnManager.inject({ emitter, persistFn })
  this.dagScheduler.inject({ turnManager, emitter })
  this.runManager.inject({ dagScheduler, turnManager })
}
```

**关键算法：** `DAGScheduler.computeReadyNodes()` 是 DAG 调度的核心，支持条件边评估：

```
function computeReadyNodes(run):
    if run.status === 'paused': return  // 暂停时不推进
    
    for each node in run.nodes:
        if node.status !== 'pending': continue
        
        incomingEdges = edges.filter(e => e.target === node.id)
        if incomingEdges.length === 0:
            node.status = 'ready'  // 无前驱，直接 ready
        else:
            activeEdges = incomingEdges.filter(evaluateCondition)
            if allPredecessorsCompleted(activeEdges):
                node.status = 'ready'
                node.context = buildNodeContext(predecessors)  // Context Chaining
```

**数据存储结构（v2.0 — SQLite + WAL）：**

```typescript
// 持久化层
class StorageSQLite {
  private db: Database  // better-sqlite3, WAL mode
  // 表: runs, nodes, edges, turns, artifacts, inbox, schema_version
}

// 内存缓存（启动时从 SQLite 加载，运行时在内存操作，变更时写回 SQLite）
class RunManager {
  private runs: Map<string, Run>       // runId → Run 对象
  private storage: StorageSQLite       // 持久化委托
}
class TurnManager {
  private turns: Map<string, AgentTurn[]>  // nodeId → Turn 数组
}
```

Turns 独立于 Run 存储，这是为了高频追加（Agent 执行时实时写入 stdout），避免每次输出追加都要序列化整个 Run 对象。持久化通过 `StorageSQLite.saveAll()` 使用事务批量 upsert，保证崩溃安全。

### 3.2 AgentService（agent.ts，1012 行）

负责"真正执行 AI 任务"的服务——调用外部 CLI 工具并管理执行过程。

**Agent 注册与可用性检测：**

系统启动时执行 `which codex` 和 `which claude`，如果命令不存在则将对应 Agent 标记为 unavailable。这意味着在没有安装 Codex CLI 的机器上，只有 Claude Agent 可用（反之亦然）。

**执行流程详解：**

```
1. 接收 executeAgent(agentId, prompt, options) 调用
2. 查找 Agent 配置，确认状态为 available
3. 构造 CLI 命令（如: codex --prompt "..." --model gpt-4）
4. spawn 子进程，设置 10 分钟 timeout
5. 实时收集 stdout（流式追加到 Turn.output）
6. 收集 stderr（作为 diagnostics）
7. 进程退出后:
   - exitCode === 0 → 解析 token、提取 artifact → Turn completed
   - exitCode !== 0 → Turn failed → 触发 Robustness 重试
   - timeout → 强制 kill → Turn failed
```

**Token 解析策略：**

```typescript
// 从 Agent CLI 输出中提取 token 信息
const tokenPattern = /(\d+)\s*tokens?\s*used/i
const match = output.match(tokenPattern)
if (match) turn.tokensUsed = parseInt(match[1])
```

这是一种"最大努力"的解析——如果 CLI 输出格式变了，只是统计不到 token，不会影响执行。

### 3.3 SyncService（sync.ts，1149 行）

系统中最复杂的服务，实现了无数据库部署下的数据持久化和跨设备同步。

**为什么用 GitHub Contents API 而不是 git CLI？**

三个原因：第一，避免本地 git 环境依赖（Windows 上 git 环境问题很多）；第二，Contents API 是原子操作（单文件读写），不需要处理 git 的暂存区、分支等概念；第三，API 自带 SHA 校验，能检测到并发冲突。

**Push 流程：**

```
1. 收集所有 dirty 数据（修改过的 runs、projects）
2. 对每个 Run：
   a. 从 turns Map 中取出该 Run 所有节点的 turns
   b. 作为 _turns 字段嵌入 Run JSON
   c. 序列化为 JSON 字符串
3. Base64 编码内容
4. 调用 GitHub Contents API PUT（带上 SHA 实现乐观锁）
5. 如果 SHA 冲突（409）→ 触发 LWW 逻辑
6. 更新本地 SHA 缓存
```

**Pull 流程：**

```
1. 列出远程 users/{login}/projects/ 目录
2. 对每个文件，比较本地 SHA 与远程 SHA
3. SHA 不同 → 下载最新内容
4. 解析 JSON，提取 _turns 字段 → 还原到 turns Map
5. 删除 JSON 中的 _turns 字段 → 得到纯 Run 对象
6. 更新本地 runs Map
```

**gitRemote 匹配机制：**

当用户在新设备上 pull 数据时，远程存储的项目路径（如 `/Users/alice/code/my-project`）在新设备上可能不存在。系统通过以下策略解决：

```
1. 读取远程项目的 gitRemote 字段（如 git@github.com:alice/my-project.git）
2. 扫描本地已知项目的 git remote
3. 如果有 remote URL 匹配 → 自动关联（本地路径不同但是同一个项目）
4. 如果没有匹配 → 标记为"未关联"，等待用户手动指定本地路径
```

### 3.4 DynamicAgentFactory— 动态 Agent 实例工厂

每个 TaskNode 执行前，系统不是直接调用某个全局 Agent，而是为该节点**动态创建一个专属的 Agent 实例**。这个实例携带了精确的 `ScopedContext`（作用域上下文），包含：

- **角色定义**：该节点的角色（planner/manager/executor）对应的 system prompt
- **前驱输出**：DAG 中所有已完成的前驱节点的产出物
- **项目上下文**：当前项目的技术栈、目录结构、编码规范等
- **ContextDB 知识**：从四层知识库中查询出的相关信息

这保证了每个 Agent 只看到它需要的信息，避免上下文污染。

### 3.5 ContextDB — 四层知识库

```
优先级（低 → 高）：

┌─────────────────────────────┐
│  SYS 层 - 系统预置知识       │  如："你是一个代码助手"
├─────────────────────────────┤
│  L0 层 - 全局共享知识         │  如：公司编码规范、通用 API 文档
├─────────────────────────────┤
│  L1 层 - 项目级知识           │  如：这个项目用 React + TypeScript
├─────────────────────────────┤
│  L2 层 - 节点级知识           │  如：这个节点处理支付模块的重构
└─────────────────────────────┘
```

查询时**自底向上合并**，同 key 冲突时低层（更具体的）覆盖高层。类比：CSS 的层叠规则——`inline style > class > tag > *`。

存储方式：文件系统中的 JSON 文件，路径为 `~/.agent-flow/context-db/{layer}/{key}.json`。

### 3.6 A2AProtocolService — Agent 间通信

A2A（Agent-to-Agent）协议实现了 Agent 之间的结构化通信，模拟了人类团队中的"委派-汇报"模式：

**消息类型：**
- `delegated_task`：Manager 委派任务给 Executor
- `task_delivery`：Executor 完成后交付结果
- `status_update`：进度汇报
- `resource_request`：请求资源（如仓库访问权限）

**可靠性机制：**
- 优先级队列：critical > high > normal > low
- ACK 确认：关键消息要求接收方确认
- TTL 过期：默认 30 分钟未处理自动过期
- 自动重试：最多 3 次

**与 Inbox 的关系：** A2A 是新的通信协议，旧的 Inbox 系统通过 bridge 层兼容。长期目标是完全迁移到 A2A。

### 3.7 RobustnessService — 容错与可观测

这个服务为整个系统提供"安全网"，包含四个子能力：

| 能力 | 作用 | 关键参数 |
|------|------|----------|
| 重试 | 失败任务自动重试 | 指数退避，最多 3 次，最大延迟 120s |
| 死信队列（DLQ） | 重试耗尽后存入等待人工处理 | 人工可查看/重新投递/删除 |
| Checkpoint | 定期保存 Run 快照 | 每个 Run 最多 20 个快照 |
| 审计日志 | 记录所有关键操作 | 上限 5 万条，支持按时间/类型查询 |

---

## 四、客户端架构

### 4.1 技术栈

- **构建工具**：Vite（快速 HMR + 优化构建）
- **UI 框架**：React 18 + TypeScript
- **组件库**：Ant Design 5
- **状态管理**：Zustand（轻量级，单 store）
- **路由**：React Router v6（lazy 加载）
- **实时通信**：原生 WebSocket
- **Markdown 渲染**：react-markdown + remark-gfm + Prism 语法高亮

### 4.2 状态管理设计

Zustand store 是客户端的"单一数据源"，结构如下：

```typescript
// 核心状态切片
{
  projects: ProjectData[]     // 项目列表
  runs: Run[]                 // 工作流运行记录
  agents: AgentConfig[]       // Agent 配置列表
  activeTurns: Map<nodeId, AgentTurn[]>  // 当前活跃的执行回合
  skills: Skill[]             // 技能列表
  templates: Template[]       // 工作流模板
  taskLog: LogEntry[]         // 任务日志
}
```

WebSocket 消息到达时，直接 patch 对应的 store 切片，UI 自动响应更新（Zustand 的 selector 机制保证只有相关组件 re-render）。

### 4.3 WebSocket 实时通信

连接管理策略：
- 初始化时自动建立连接
- 断线后每 3 秒自动重连
- 消息类型覆盖：`run:updated`、`node:updated`、`turn:started`、`turn:output`（流式输出）、`turn:completed`、`run:completed`

### 4.4 路由结构

所有页面组件 lazy 加载，采用 `HashRouter` 以适配 GitHub Pages 静态托管环境：

```
/agent-flow/#/
├── /                     → Dashboard（项目概览）
├── /projects/:id         → 项目详情 + Run 列表
├── /runs/:id             → Run 详情（核心页面，1410 行）
├── /agents               → Agent 管理
├── /settings             → 系统设置
├── /changelog            → 更新日志
└── /about                → 关于页面
```

---

## 五、设计决策与权衡分析

### 5.1 为什么用 GitHub Contents API 而不是 git CLI？

| 维度 | GitHub API | git CLI |
|------|-----------|--------|
| 环境依赖 | 只需网络 + Token | 需要安装 git + SSH 配置 |
| 跨平台一致性 | 完全一致 | Windows/Mac/Linux 行为差异 |
| 部署复杂度 | 零（纯 HTTP） | 需要处理 SSH key、GPG 签名等 |
| 功能上限 | 无分支/merge 能力 | 完整 git 能力 |
| 性能 | 单文件操作需要多次 API 调用 | 批量操作高效 |

**取舍：** 在个人/小团队场景下，简单性 > 功能完整性。如果未来需要分支管理，可以切换到 GitHub REST API 的 Git Data 端点（trees/blobs/commits）。

### 5.2 为什么选择 SQLite + 内存缓存的双层架构？（v2.0 更新）

**v1.0 方案：** 纯内存 Map，进程崩溃丢失最近 5s 数据。

**v2.0 方案：** SQLite（WAL 模式） + 内存 Map 缓存。启动时从 SQLite 加载到内存，运行时在内存操作（保持 O(1) 读取性能），变更时通过事务写回 SQLite。

选择 SQLite 而非 PostgreSQL/MySQL 的原因：

- **零额外服务**：SQLite 是嵌入式库，以单个 `.db` 文件存在，不需要 daemon 进程
- **崩溃安全**：WAL 模式保证即使进程 crash，已提交的事务不会丢失
- **零运维**：不需要备份策略（文件级复制即可）、不需要连接池管理
- **性能足够**：同步 API（better-sqlite3），单机场景写入 > 10 万行/秒
- **自动迁移**：首次启动检测旧版 JSON 数据文件，自动导入 SQLite

保留内存 Map 的原因是 Agent 执行时的高频流式输出追加（每秒数十次 `appendTurnOutput`），直接写内存避免 I/O 抖动，批量持久化由 `persist()` 统一处理。

### 5.3 为什么是 "Human-in-the-loop" 而不是全自动？

当前 AI Agent 的输出质量不够稳定，完全无人值守可能产生"错误雪崩"——前一个节点的错误输出传递给下一个节点，导致整个工作流产出无用结果。`wait_user_review` 状态是一个"断路器"，让人可以在每个节点及时修正方向。

未来随着 Agent 可靠性提升，可以逐步开放"自动模式"（跳过 review 直接 complete）。

### 5.4 为什么预注册 10 个 Agent 而不是按需创建？

- **可预测性**：启动时检测可用性，避免运行时才发现 CLI 不存在
- **资源控制**：固定数量 = 固定并发上限，防止意外 fork bomb
- **命名稳定性**：节点绑定的 agentId 是固定的，不会因为动态创建而 ID 漂移

---

## 六、数据流全景

### 6.1 工作流执行的完整生命周期

```
用户创建 Run（选择模板/手动定义 DAG）
        │
        ▼
WorkflowEngine.createRun() → 初始化所有节点为 pending
        │
        ▼
computeReadyNodes() → 找出无前驱的起始节点 → 标记为 ready
        │
        ▼
用户点击"执行"（或自动触发）→ 节点进入 running
        │
        ▼
DynamicAgentFactory 组装 ScopedContext
        │
        ▼
AgentService.execute() → spawn CLI 子进程
        │
        ▼
(等待执行，WebSocket 推送流式输出 turn:output)
        │
        ▼
CLI 执行完成 → 解析 Token + Artifacts → 创建 AgentTurn
        │
        ▼
节点进入 wait_user_review → 用户审查
        │
        ▼
用户 approve → 节点 completed → 触发 computeReadyNodes()
        │
        ▼
(循环，直到所有节点完成)
        │
        ▼
所有节点 completed → Run 进入 completed 状态
        │
        ▼
自动触发 SyncService.push()（5 秒 debounce）
```

### 6.2 同步数据流

```
Push 流程：
内存 Run + Turns → 组装 JSON（嵌入 _turns） → GitHub Contents API PUT → 远程仓库

Pull 流程：
GitHub Contents API GET → JSON → 提取 _turns 到 Map → 更新内存 Run

冲突处理：
Push 前获取远程 SHA → 如果 SHA 不匹配（说明远程已变更）→ Pull 最新 → LWW 覆盖 → 重新 Push
```

---

## 七、设计亮点总结

从工程角度来看，这个系统在以下方面体现了优秀的架构判断：

### 7.1 "人在回路"（Human-in-the-Loop）的务实选择

在当前阶段 AI Agent 输出质量尚不稳定的背景下，系统没有追求"全自动"的酷炫感，而是在每个节点完成后插入 `wait_user_review` 状态作为"断路器"。这防止了"错误雪崩"——前一个节点的错误输出被盲目传递给下一个节点，导致整个链路产出无用结果。

这个设计的巧妙之处在于它是**渐进可放松的**：未来随着 Agent 可靠性提升，只需为特定节点配置 `autoApprove: true` 即可跳过人工审核，无需架构级变更。

### 7.2 三种执行模式的灵活性

LLM/DET/HYB 三种模式的设计，让系统在效率和智能之间找到了平衡：

- **确定性任务**（如格式检查、文件复制、脚本执行）用 DET 模式，零 Token 消耗，执行快且结果可预期
- **创造性任务**（如代码生成、方案设计）用 LLM 模式，充分利用大模型能力
- **不确定性任务**用 HYB 模式，先尝试低成本路径，失败再回退到 LLM

这避免了"所有任务都过 LLM"带来的不必要成本和延迟。

### 7.3 GitHub Contents API 作为零成本同步后端

这是一个非常聪明的架构选择。用户只需一个 GitHub Personal Access Token 即可获得：

- **跨设备同步**：多台机器间自动保持数据一致
- **版本历史**：每次 push 产生 commit，天然具备时间线回溯能力
- **多用户隔离**：通过目录结构 `users/{login}/` 实现
- **零运维成本**：不需要部署任何数据库或存储服务

对比传统方案（自建 PostgreSQL + 部署服务器 + 管理备份），这个选择极大降低了项目的启动和维护成本。

### 7.4 ContextDB 四层模型——"知识注入的 CSS 层叠"

四层知识库设计（SYS → L0 → L1 → L2）让 Agent 在每个节点获得的上下文既全面又精准：

- 系统层提供基础人格和通用指令
- 全局层提供团队规范
- 项目层提供技术栈和架构决策
- 节点层提供当前任务的专属上下文

查询时自底向上合并、低层覆盖高层的规则，等同于 CSS 的层叠优先级。这保证了越具体的知识优先级越高，避免了"全局规则覆盖局部需求"的问题。

### 7.5 事件驱动的 DAG 调度

系统不使用轮询或定时调度，而是采用事件驱动的"反应式"推进策略：每当一个节点完成时，立即触发 `computeReadyNodes()` 扫描并解锁满足条件的下游节点。

这带来两个好处：一是**零延迟推进**（不需要等待下一个调度周期），二是**天然支持并行**（一个节点完成后可能同时解锁多个独立的下游节点）。

### 7.6 Turns 的"逻辑分离、物理合并"存储策略

Turns（Agent 执行回合）在内存中独立于 Run 存储（`Map<nodeId, AgentTurn[]>`），这方便了高频追加操作（Agent 执行时每秒都在写入 stdout）。但同步到 GitHub 时，将 Turns 临时嵌入 Run JSON 的 `_turns` 字段一起上传，避免了每个 Turn 都需要单独一次 API 调用。

这是典型的"读写优化分离"思路——本地优化写入性能（独立 Map），远程优化传输效率（合并为一个文件）。

### 7.7 A2A 协议的"绞杀者模式"演进

新的 A2A（Agent-to-Agent）通信协议没有一次性替换旧的 Inbox 系统，而是通过 bridge 层兼容旧系统的同时逐步迁移。这是经典的 Strangler Fig Pattern（绞杀者模式）——新系统像藤蔓一样逐步包裹旧系统，最终完全替代它，但在过渡期间两者可以共存。

---

## 八、扩展性评估

### 8.1 水平扩展能力

**当前状态：** 单进程架构，不支持水平扩展。数据通过 SQLite 持久化 + 内存 Map 缓存，但仍为单进程读写，WebSocket 连接也只在单进程内广播。

**扩展路径：** 如果未来需要支持多实例部署（如高可用或大规模用户），需要进行以下改造：

| 组件 | 当前方案 | 扩展方案 |
|------|----------|----------|
| 数据存储 | SQLite + 内存 Map（单机） | Redis（热数据） + PostgreSQL（持久化） |
| WebSocket 广播 | 进程内 Set 遍历 | Redis Pub/Sub 跨实例广播 |
| 会话亲和 | 不需要（单进程） | Sticky Session 或 Session Store |
| 定时任务 | setTimeout | 分布式锁（如 Redis Lock）保证单执行 |

**评估结论：** 对于当前个人/小团队定位（<10 用户），单进程完全够用。只有在用户规模增长到需要多机部署时才需要考虑这些改造。

### 8.2 DAG 规模承载能力

**当前算法：** `computeReadyNodes()` 每次全量扫描所有 `pending` 节点并检查其前驱状态，时间复杂度为 O(N × E)（N = pending 节点数，E = 平均入边数）。

**实际影响：**

| DAG 规模 | 节点数 | 预期耗时 | 结论 |
|----------|--------|----------|------|
| 小型（典型） | 5~20 | < 1ms | 无需优化 |
| 中型 | 50~100 | < 10ms | 可接受 |
| 大型 | 200~500 | 可能 50ms+ | 需要优化 |
| 超大型 | 1000+ | 可能成为瓶颈 | 必须重写 |

**优化方向：** 如果未来支持超大 DAG，可改为"增量式拓扑排序"——维护每个节点的"未完成前驱计数器"，节点完成时只需将其后继的计数器减 1，计数器归零即可推进。时间复杂度降为 O(K)（K = 刚完成节点的出边数）。

### 8.3 Agent 池并发能力

**当前限制：** 10 个预注册 Agent，通过 `child_process.spawn` 在本机执行 CLI。并发受限于：

- CPU/内存资源（每个 CLI 进程会占用一定资源）
- CLI 工具自身的速率限制（如 OpenAI API Rate Limit）
- 10 分钟超时上限

**扩展方向：** 如需支持高并发执行（如同时运行 50+ 个节点），可考虑：

- 引入任务队列（如 BullMQ）控制并发度
- 支持远程 Agent Worker（将 CLI 执行分布到多台机器）
- 按 Agent 类型设置独立的并发限制

### 8.4 同步性能

**当前瓶颈：** GitHub Contents API 是单文件操作，每个 Run 的 push/pull 需要至少 1 次 API 调用。如果有 50 个 Run 发生变更，就需要 50 次顺序 API 调用（受 GitHub Rate Limit 约束：5000 次/小时）。

**优化方向：**

- 批量操作可切换到 GitHub Git Data API（通过 trees/blobs/commits 一次提交多文件）
- 引入增量同步：只 push 自上次同步以来变更过的 Run（当前已通过 dirty 标记实现）
- 加入本地缓存层：只有 SHA 变化时才下载内容

### 8.5 存储容量

**当前约束：** GitHub 仓库建议单文件 < 100MB，仓库总体 < 5GB。单个 Run JSON（含嵌入的 Turns）在正常使用下约 50KB~500KB。

**容量估算：**

| 使用强度 | Run 数量/月 | 月增量 | 一年后总量 | 结论 |
|----------|-------------|--------|------------|------|
| 轻度 | 10~50 | ~5MB | ~60MB | 无压力 |
| 中度 | 100~500 | ~50MB | ~600MB | 可接受 |
| 重度 | 1000+ | ~500MB | ~6GB | 接近上限，需归档策略 |

**应对策略：** 对于重度使用场景，可引入"归档"机制——超过 N 天的已完成 Run 自动归档到独立分支或压缩存储。

---

## 九、技术债识别与改进路线图

### 9.1 改造项目清单

| # | 问题 | 建议方案 | 状态 |
|---|------|----------|------|
| 1 | 无本地持久化 | 引入 SQLite + WAL（better-sqlite3），单 `.db` 文件，零额外服务 | **✅ 已完成** — `storage-sqlite.ts`，自动迁移旧 JSON |
| 2 | 无自动化测试 | vitest 单测覆盖核心模块 | **✅ 已完成** — 6 个测试文件，122 个用例全通过 |
| 3 | WorkflowEngine 职责过重 | Facade 模式拆分为 RunManager + DAGScheduler + TurnManager | **✅ 已完成** — 外部 API 零变更 |
| 4 | api.ts 过大（1575 行） | 按域拆分为 12 个子路由文件 | **✅ 已完成** — 协调器仅 ~130 行 |
| 5 | RunDetail.tsx 过大（1410 行） | 抽取 custom hooks + 拆分子组件 | ⏳ 待改造 |

### 9.2 无需改造的项目

| # | 原始问题 | 结论 | 原因 |
|---|----------|------|------|
| 6 | LWW 冲突策略可能导致多人同时编辑丢数据 | **无需改造** | 系统跟随账户登录，同一时间只有一台设备在操作同一个 Run，不存在并发写入的前提条件。LWW 冲突在当前使用模式下不会触发数据丢失 |
| 7 | Agent CLI 调用缺少沙箱隔离 | **无需改造** | Agent 执行时通过 `spawn` 的 `cwd` 参数限定在对应项目目录下操作；且 Codex/Claude CLI 工具自身已内置安全沙箱机制（如 codex 的 sandbox 模式），宿主机风险已由 CLI 工具自行管控 |
| 8 | WebSocket 无鉴权 | **暂不改造** | 当前为单用户本地部署场景，服务端口仅在 localhost 监听，不存在外部访问的安全隐患。待未来支持多用户远程部署时再引入 token 验证 |

### 9.3 改造进度与后续计划

```
✅ 第一步：#4 拆分 api.ts → 12 个子路由文件（已完成）
✅ 第二步：#3 拆分 WorkflowEngine → Facade + 3 模块（已完成）
✅ 第三步：#1 引入 SQLite + WAL 本地持久化（已完成）
✅ 第四步：#2 引入 vitest 单测，覆盖 122 个用例（已完成）
⏳ 第五步：#5 拆分 RunDetail.tsx（待改造）
```

---

## 十、关键代码文件索引

快速定位核心逻辑的"地图"：

| 文件路径 | 行数 | 核心职责 |
|----------|------|----------|
| `server/src/types/index.ts` | 630 | 全部类型定义，理解系统的起点 |
| `server/src/services/workflow-engine.ts` | 248 | **Facade 门面**：委托 RunManager + DAGScheduler + TurnManager |
| `server/src/services/run-manager.ts` | 564 | Run CRUD + 节点状态机 + 持久化调度 |
| `server/src/services/dag-scheduler.ts` | 214 | DAG 拓扑排序 + 就绪节点计算 + 条件边评估 |
| `server/src/services/turn-manager.ts` | 271 | AgentTurn 生命周期 + Token 统计 |
| `server/src/services/storage-sqlite.ts` | 591 | SQLite + WAL 持久化层（替代 JSON 文件） |
| `server/src/services/agent.ts` | 1012 | Agent 执行调度 + CLI 进程管理 |
| `server/src/services/sync.ts` | 1149 | GitHub 同步 + 多用户隔离 + 冲突处理 |
| `server/src/services/dynamic-agent-factory.ts` | 369 | 动态 Agent 实例化 + 上下文组装 |
| `server/src/services/context-db.ts` | 309 | 四层知识库管理 |
| `server/src/services/a2a-protocol.ts` | 434 | Agent 间通信协议 |
| `server/src/services/robustness.ts` | 356 | 重试 + 死信队列 + Checkpoint + 审计 |
| `server/src/routes/api.ts` | 146 | 路由注册入口（已拆分为 12 个子路由文件） |
| `server/src/routes/runs.ts` | 202 | Run 相关 REST 端点 |
| `server/src/routes/agents.ts` | 248 | Agent 相关 REST 端点 |
| `server/src/index.ts` | 298 | 服务启动 + WS 广播 + 优雅关闭 |
| `server/tests/*.test.ts` | 1867 | **6 个测试文件，122 个用例** |
| `client/src/store/appStore.ts` | 278 | Zustand 全局状态 + WS 消息处理 |
| `client/src/api/index.ts` | 577 | HTTP + WS 客户端封装 |
| `client/src/components/detail/RunDetail.tsx` | 1410 | Run 详情页（最复杂的 UI 组件） |

---

## 十一、快速上手建议

如果你是第一次阅读这个项目代码，建议按以下顺序：

1. **先读类型文件** `types/index.ts` —— 建立数据模型的心智模型，知道 Run / TaskNode / AgentTurn 这三个核心实体的字段含义
2. **再读 WorkflowEngine（Facade）** —— 理解它如何将请求委托给三个子模块
3. **深入三个核心子模块** —— RunManager（Run CRUD + 状态机）→ DAGScheduler（拓扑调度）→ TurnManager（Turn 生命周期）
4. **了解持久化层** `storage-sqlite.ts` —— 理解数据如何落盘和加载
5. **然后读 AgentService** —— 理解 Agent 是如何被调用的，CLI 进程如何管理
6. **最后读 SyncService** —— 理解数据如何跨设备同步
7. **跑测试** `npx vitest run` —— 通过 122 个用例理解各模块的行为边界

其他服务（ContextDB、A2A、Robustness）可以在需要时再深入。

---

## 十二、总结与全局评价

### 12.1 系统定位

AgentFlow（内部称 MAF — Multi-Agent Flow）是一个多智能体 DAG 工作流编排平台。它的核心使命是：让用户以可视化方式定义一个有向无环图（DAG），图中每个节点绑定一个 AI Agent，系统自动按拓扑序调度执行，实现复杂多步任务的自动化完成。

整体采用 Monorepo + Workspaces 结构（Node >= 20），分为 `packages/server`（Express + WS）和 `packages/client`（Vite + React）两个包，通过 `concurrently` 并行启动开发环境，通过 `gh-pages` 部署前端静态资源。

### 12.2 代码规模一览

| 维度 | 数值 |
|------|------|
| 服务端核心逻辑 | ~6,500 行（含 4 个新模块） |
| 服务端测试 | ~1,900 行（6 文件，122 用例） |
| 客户端代码 | ~3,000+ 行 |
| 核心服务数 | 11 个（含 RunManager、DAGScheduler、TurnManager、StorageSQLite） |
| REST API 端点 | 70+（分布在 12 个路由文件中） |
| 类型定义 | 630 行（完整的 TypeScript 类型系统） |

### 12.3 架构决策总评

AgentFlow 在以下方面做出了务实的架构选择：

- **用 GitHub API 避免部署数据库服务** —— 远程同步零运维成本，适合个人/小团队快速验证
- **用 SQLite + 内存 Map 双层架构** —— 兼顾持久化安全与读写性能，无 ORM 依赖，数据结构调整无需 migration
- **用人在回路保证安全性** —— 在 Agent 可靠性不够高的阶段，这是正确的风控策略
- **用三种执行模式平衡效率与灵活性** —— 确定性任务不浪费 Token，创造性任务充分利用 LLM

系统的架构清晰度很高，命名和注释都很规范，核心模块之间的职责划分明确。

### 12.4 风险现状（改造后）

经过本轮重构，原有三大核心风险中的两个已彻底解决，剩余一个已大幅缓解：

**风险一：数据可靠性 ✅ 已解决。** 引入 SQLite + WAL 模式作为本地持久化层，数据实时落盘。进程崩溃不再丢失数据。启动时自动检测并迁移旧版 JSON 文件，向后兼容。

**风险二：代码可维护性 ⚠️ 大幅改善。** 服务端核心已完成拆分：WorkflowEngine 从 1068 行缩减为 248 行的 Facade，实际逻辑分散到 RunManager（564）、DAGScheduler（214）、TurnManager（271）三个单职责模块；api.ts 从 1575 行拆分为 12 个子路由文件。剩余待改造：客户端 RunDetail.tsx（1410 行）。

**风险三：重构安全性 ✅ 已解决。** 引入 vitest 测试框架，建立 6 个测试文件共 122 个用例，覆盖 DAG 调度、节点状态机、Turn 生命周期、SQLite 持久化等核心路径。后续任何重构都有回归测试保障。

### 12.5 一句话总结

AgentFlow 是一个设计清晰、功能完备的多智能体编排系统。经过本轮重构，服务端已建立起 Facade + 单职责模块 + SQLite 持久化 + 122 测试用例的工程基础，具备了规模化迭代的条件。下一步的核心任务是完成客户端 RunDetail.tsx 的拆分，并持续扩展测试覆盖到 SyncService 和 AgentService 等模块。

---

> 文档版本：v2.0 | 基于代码 commit 截止 2026-06 分析 | 如有更新请同步维护此文档
