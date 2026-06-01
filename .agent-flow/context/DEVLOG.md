# 开发日志

## 2026-06-01 — v2.7.2 多用户数据隔离 + 跨设备 gitRemote 自动匹配

### 设计决策

v2.7.1 实现了基于 GitHub Private Repo 的数据同步，但存在两个问题：① 远端仓库结构是扁平的，多用户共享同一个仓库时数据会冲突；② 用户在新设备 Pull 数据后，项目的本地路径不同导致无法正确关联。

经过讨论，确定了以下方案：
- **多用户隔离**：远端仓库改为 `users/{github_login}/` 按用户组织数据，每个用户有独立的 projects/templates/runs/context-db，互不干扰
- **跨设备匹配**：通过 `gitRemote` 字段自动匹配项目，而非依赖本地路径。用户只需 clone 项目 → 在 AgentFlow 添加项目 → Pull，系统自动完成匹配
- **拒绝全自动方案**：用户明确指出"先把项目代码拉到本地，然后在系统内添加项目指定本地路径，最后再 Pull 同步数据"才是合理的流程，前两步手动操作、第三步自动匹配

### 后端实现

**ProjectService 扩展**（`packages/server/src/services/project.ts`）：
- `detectGitRemote(path)` — 执行 `git remote get-url origin` 自动获取项目的远程仓库 URL
- `normalizeGitRemote(url)` — 标准化 SSH/HTTPS URL 为统一格式（`github.com/user/repo`），去除 `.git` 后缀和协议差异
- `addProjectWithId(id, data)` — 支持指定 ID 添加项目（用于 Pull 时保持远端 ID）
- `replaceProjectId(oldId, newId)` — 替换项目 ID，同时更新所有关联的 Runs 和 Context DB 路径
- `addProject()` 改造：创建项目时自动调用 `detectGitRemote()` 填充 `gitRemote` 字段

**SyncService 扩展**（`packages/server/src/services/sync.ts`）：
- `SyncConfig` 新增 `pathMapping: Record<string, string>` 字段
- `mergeProjects()` 重写：Pull 时遍历远端项目列表，优先通过 `normalizeGitRemote()` 匹配本地项目，匹配成功则调用 `replaceProjectId()` 替换 ID；未匹配的项目通过 `pathMapping` 兜底
- `getPathMapping()` / `setPathMapping()` / `removePathMapping()` — pathMapping CRUD
- `getRemoteProjects()` — 获取远端项目列表（用于前端展示未匹配项目）

**类型扩展**（`packages/server/src/types/index.ts`）：
- `ProjectData` 新增 `gitRemote?: string` 可选字段

**API 路由扩展**（`packages/server/src/routes/api.ts`）：
- `GET /api/sync/remote-projects` — 获取远端项目列表
- `GET /api/sync/path-mapping` — 获取路径映射配置
- `POST /api/sync/path-mapping` — 设置路径映射
- `DELETE /api/sync/path-mapping/:projectId` — 删除路径映射

### 远端仓库结构（v2.7.2）

```
agent-flow-data/  (private)
├── users/
│   └── {github_login}/
│       ├── projects.json
│       ├── templates.json
│       ├── runs/
│       │   └── {runId}.json
│       └── context-db/
│           ├── _global/
│           └── {projectId}/
├── shared/
│   └── (预留：未来团队共享资源)
└── manifest.json
```

### 跨设备使用流程

1. **新设备首次使用**：`git clone` 需要的项目代码到本地
2. **在 AgentFlow 中添加项目**：指定本地路径，系统自动 `detectGitRemote()` 记录 gitRemote
3. **Pull 同步数据**：系统自动通过 gitRemote 匹配远端项目，`replaceProjectId()` 统一 ID，Runs/ContextDB 数据自动对齐

### 编译验证

Server `tsc --noEmit` 通过（仅有一个预存在的 feedback-collector.ts unused import warning）。

---

## 2026-06-01 — v2.7.1 GitHub Private Repo 数据同步

### 设计决策

用户需要在公司电脑和休息日使用的其他设备间同步数据。经过方案对比（GitHub Gist、Supabase、自建服务器），最终选择 **GitHub Private Repo** 方案：利用用户已有的 GitHub 账号，创建一个独立的私有仓库（`agent-flow-data`）专门托管数据，通过 GitHub Contents API 进行文件 CRUD，无需本地 git CLI。

核心设计原则：
- 数据与系统代码解耦（独立仓库，不污染 agent-flow 主仓库）
- 仅同步关键元数据和知识资产，不同步大体积日志和敏感信息
- LWW（Last Write Wins）冲突策略，以时间戳较新为准
- 无感知自动同步（启动 pull + 变更后防抖 push），同时保留手动触发入口

### SyncService 后端（~720 行）

新增 `packages/server/src/services/sync.ts`，核心能力：

- **GitHub Contents API 封装**：`getFile` / `putFile` / `deleteFile` / `listDir` 四个基础方法
- **Push（本地 → 远端）**：推送 projects.json、templates.json、runs/（每个 Run 一个文件）、context-db/（递归上传项目级上下文文件）、manifest.json
- **Pull（远端 → 本地）**：拉取远端数据并合并到本地，支持 LWW 冲突检测
- **Context DB 同步**：`pushContextDb()` 递归扫描各项目的 `.agent-flow/context/` 目录上传到远端 `context-db/{projectId}/`；`pullContextDb()` 递归下载到对应本地路径
- **自动同步**：`markDirty()` 标记数据变更，`autoSyncIfNeeded()` 检测并触发 push
- **仓库管理**：`createSyncRepo()` 一键创建私有仓库，`ensureRepoStructure()` 初始化远端目录结构

### 远端仓库结构

```
agent-flow-data/  (private)
├── manifest.json          (元信息：版本、同步时间、数据计数)
├── projects.json          (项目列表)
├── templates.json         (工作流模板)
├── runs/
│   └── {runId}.json       (每个 Run 独立文件，不含完整 output)
└── context-db/
    ├── _global/           (全局 SYS/L0/L1/L2 层)
    └── {projectId}/       (项目级 context 文件)
```

### Sync API 路由

新增 6 条路由：
- `GET /api/sync/status` — 获取同步状态（configured / authenticated / dirty / lastSyncAt）
- `GET /api/sync/config` — 获取同步配置
- `POST /api/sync/config` — 配置同步仓库（repoFullName + autoSync）
- `PATCH /api/sync/config` — 更新自动同步开关
- `DELETE /api/sync/config` — 断开同步
- `POST /api/sync/push` — 手动触发 push
- `POST /api/sync/pull` — 手动触发 pull
- `POST /api/sync/create-repo` — 创建同步仓库

### 前端 SyncPanel 组件

新增 `packages/client/src/components/sidebar/SyncPanel.tsx`（~350 行）：
- 同步状态指示灯（已配置/未配置/同步中）
- Push / Pull 按钮 + 操作结果反馈
- Auto Sync 开关
- 断开同步操作
- `SyncConfigModal` 弹窗：仓库选择（列出用户 repos）或创建新仓库

### 主入口集成

- `packages/server/src/index.ts`：实例化 SyncService，启动时加载配置 + 自动 pull，WorkflowEngine 事件触发 markDirty + 防抖 autoSync
- `packages/client/src/components/sidebar/Sidebar.tsx`：集成 SyncPanel 组件
- `packages/client/src/api/index.ts`：新增 `syncApi` 客户端方法

### 实际验证

- 创建了私有仓库 `XiaoPeng1112/agent-flow-data`
- 首次 push 成功同步 13 个文件（2 项目 + 4 模板 + 4 Run + 6 Context 文件 + manifest）
- curl 验证远端仓库结构和文件内容完全正确
- 后端服务模块数 21 → 22（+SyncService）

---

## 2026-05-31 — v2.7.0 反馈闭环 + 周报摘要

### 设计决策

在 v2.6.0 实现了 Metrics 可观测性后，面临"如何保证后续使用中发现问题再迭代"的课题。经过分析，放弃了"完整自演进系统"（自动发现→自动决策→自动执行→自动验证），选择了**轻量采集 + 人工决策**模式。

核心原因：
- 自动化决策在数据量不足时容易误判，"元循环"（系统改进自身）容易失控
- AgentFlow 的核心价值是"编排 Agent 完成开发任务"，不是"管理自己"
- 用户 + AI 对话本身就是最高效的改进执行方式

约束规则写入 ADR-016，作为后续迭代的护栏。

### FeedbackCollector（~250 行）

新增反馈采集器服务，在三个触发点自动记录结构化反馈：
- `review_reject`：审批打回时记录原因、重试次数、关联节点
- `diff_discard`：Diff Review 丢弃时记录被丢弃的文件数
- `execution_failure`：执行失败时记录错误类型（timeout/crash/error）和堆栈

数据持久化为 JSON Lines 格式（`~/.agent-flow/feedback/YYYY-MM-DD.jsonl`），每天一个文件，支持按时间范围/类型/严重度查询。

### WeeklyDigest（~260 行）

新增周报摘要生成器，手动触发或定期调用，汇总 feedback + metrics 数据输出 Markdown 摘要到 `~/.agent-flow/context/WEEKLY-DIGEST.md`。包含：
- 执行概览（Run 数/完成率/平均耗时/Token 消耗）
- 反馈统计（打回/丢弃/失败次数 + 严重度分布）
- 高频问题 Top 5（按模式归类 + 改进建议）
- Agent 表现排行（一次通过率 + 平均 Token）

### 前端变更

MetricsPanel 新增「反馈」子 Tab，复用现有面板容器不新增顶级入口。显示：
- 4 个统计卡片（总反馈/打回/失败/Diff 丢弃）
- 反馈记录列表（按时间倒序，显示类型/严重度/摘要）
- "生成周报摘要"按钮

### API 路由

新增 4 条路由：
- `POST /api/feedback` — 查询反馈记录
- `GET /api/feedback/stats` — 获取反馈统计
- `POST /api/feedback/digest` — 触发生成周报摘要
- `POST /api/feedback/note` — 记录手动备注

### 服务数量

后端服务 19 → 21（+FeedbackCollector, +WeeklyDigest）

---

## 2026-05-31 — v2.6.0 产出物闭环 + 可观测性增强

### 产出物闭环（ArtifactMergeService + DiffReviewPanel）

**完成内容**：

1. **ArtifactMergeService**（`packages/server/src/services/artifact-merge.ts`，~250 行）
   - `prepareDiffReview(runId)` — 在 Git worktree 环境执行 `git diff`，将 unified diff 解析为结构化 `FileDiff[]`（含 DiffHunk、DiffLine，精细到行级别，区分 added/removed/context）
   - `mergeBranch(runId, strategy)` — 支持三种合并策略：squash（压缩为单次提交）、merge（保留完整提交历史）、rebase（变基到目标分支）
   - `discardBranch(runId)` — 清理 worktree 工作目录 + 删除功能分支
   - `getFileDiff(runId, filePath)` — 获取单个文件的增量 diff（支持定点审查）

2. **DiffReviewPanel 组件**（`packages/client/src/components/detail/DiffReviewPanel.tsx`，~450 行）
   - GitHub PR 风格文件树：文件名 + 变更统计（+N / -N）+ 展开/收起
   - 行级 Diff 渲染：添加行绿色背景、删除行红色背景、上下文行灰色
   - Hunk 折叠/展开控制
   - 合并策略选择器：Radio Group（Squash / Merge Commit / Rebase）
   - Approve 按钮（执行合并）+ Discard 按钮（丢弃变更）
   - 加载/空状态/错误状态完善处理

3. **API 路由扩展**（`packages/server/src/routes/api.ts`）
   - `GET /api/diff-review/:runId` — 获取 Diff Review 数据
   - `POST /api/diff-review/:runId/merge` — 执行合并（body: { strategy }）
   - `POST /api/diff-review/:runId/discard` — 丢弃分支
   - `GET /api/diff-review/:runId/file-diff` — 获取单文件 diff（query: filePath）

4. **前端 API 封装**（`packages/client/src/api/index.ts`）
   - `diffReviewApi` 对象：getDiffReview / mergeBranch / discardBranch / getFileDiff

5. **Tab 集成**（`RunDetail.tsx` + `types/index.ts`）
   - `RunDetailTab` 类型新增 `'diff-review'`
   - Tab 栏新增「Diff Review」按钮
   - 对应 render 分支渲染 DiffReviewPanel

### 可观测性增强（MetricsCollector + MetricsPanel）

**完成内容**：

1. **MetricsCollector 服务**（`packages/server/src/services/metrics-collector.ts`，~300 行）
   - `recordNodeStart(runId, nodeId)` — 记录节点启动时间
   - `recordNodeReview(runId, nodeId, tokensUsed)` — 记录首次审批时间和 Token 消耗
   - `recordNodeReject(runId, nodeId)` — 记录打回事件
   - `getRunMetrics(runId)` — 计算完整运行指标（总耗时、总 Token、节点数、完成率、打回率、首次通过率）
   - `buildTimeline(runId)` — 构建 Gantt 甘特图数据（节点时间跨度 + 并行度分析）
   - `getTokenDistribution(runId)` — 按节点/Agent 维度的 Token 分布
   - `getEfficiencyScores(runId)` — 计算各节点效率评分（加权 duration + token + quality）
   - `load()` / `save()` — 指标数据持久化到 `~/.agent-flow/metrics/metrics.json`

2. **MetricsPanel 组件**（`packages/client/src/components/detail/MetricsPanel.tsx`，~500 行）
   - **Overview Tab**：6 张指标卡片（总耗时、总 Token、平均节点耗时、首次通过率、打回率、效率评分）
   - **Timeline Tab**：Gantt 甘特图可视化（按节点渲染时间条形图，显示并行执行关系）
   - **Token Distribution Tab**：水平柱状图展示各节点 Token 消耗百分比
   - **Efficiency Tab**：可排序表格展示各节点效率评分 + Ant Design Progress 进度条可视化

3. **API 路由扩展**（`packages/server/src/routes/api.ts`）
   - `GET /api/metrics/:runId` — 获取 Run 完整指标
   - `GET /api/metrics/:runId/token-distribution` — Token 分布
   - `GET /api/metrics/:runId/efficiency` — 效率评分列表
   - `GET /api/metrics/:runId/trend` — 趋势数据（多 Run 对比）

4. **前端 API 封装**（`packages/client/src/api/index.ts`）
   - `metricsApi` 对象：getMetrics / getTokenDistribution / getEfficiency / getTrend

5. **Tab 集成**（`RunDetail.tsx` + `types/index.ts`）
   - `RunDetailTab` 类型新增 `'metrics'`
   - Tab 栏新增「Metrics」按钮
   - 对应 render 分支渲染 MetricsPanel

6. **WorkflowEngine 事件钩子集成**（`packages/server/src/index.ts`）
   - `node_started` 事件 → `metricsCollector.recordNodeStart()`
   - `turn_completed` 事件 → `metricsCollector.recordNodeReview()`（含 Token 统计）
   - `node_approved` 事件 → 记录通过
   - `node_rejected` 事件 → `metricsCollector.recordNodeReject()`

**技术亮点**：
- Diff 解析器完全自研，支持 unified diff 格式精准解析为结构化数据
- MetricsCollector 通过 WorkflowEngine 事件总线零侵入采集指标
- 前端 Gantt 图和柱状图均为纯 CSS/HTML 实现，无外部图表库依赖
- 指标持久化支持跨 Session 累积，历史数据可追溯

**新增文件**：
- `packages/server/src/services/artifact-merge.ts`
- `packages/server/src/services/metrics-collector.ts`
- `packages/client/src/components/detail/DiffReviewPanel.tsx`
- `packages/client/src/components/detail/MetricsPanel.tsx`

**编译验证**：Server `tsc --noEmit` 0 错误，Client `tsc --noEmit` 0 错误。

---

## 2026-05-31 — v2.5.0（续）A2A 消息面板

### A2A 消息面板前端可视化

**完成内容**：

1. **前端 A2A API 客户端封装**（`packages/client/src/api/index.ts`）
   - `a2aApi` 对象，包含 getMessages、getStats、getInbox、send、delegate、acknowledge、resolve、createChannel 方法
   - 对接后端 `/api/a2a/*` 路由

2. **A2APanel 组件**（`packages/client/src/components/detail/A2APanel.tsx`，~700 行）
   - **拓扑图视图**：SVG 力导向布局，Agent 节点按角色着色（Planner 蓝色、Executor 绿色、Manager 紫色），连线粗细反映消息量，Agent 卡片展示收发统计，通信链路列表展示类型标签
   - **时间线视图**：按时间倒序展示消息列表，支持类型/优先级筛选，点击展开 payload 详情
   - **统计视图**：总消息数、活跃 Agent 数、平均响应时间、通道数统计卡片 + 消息类型分布柱状图 + 优先级分布 + Agent 活跃度排行

3. **Tab 集成**（`packages/client/src/components/detail/RunDetail.tsx`）
   - `RunDetailTab` 类型新增 `'a2a'`
   - Tab 栏新增「A2A 消息」按钮
   - 对应 render 分支渲染 A2APanel

4. **类型定义**（`packages/client/src/types/index.ts`）
   - 新增 A2AMessage、A2AStats、A2AChannel、A2AMessageType、A2AMessageStatus、A2APriority 类型

**技术亮点**：
- 纯 SVG 实现拓扑图（环形布局算法），无外部图形库依赖
- 三种视图模式无缝切换，共享数据层
- 消息类型标签自动颜色映射
- 通信链路自动聚合统计

---

## 2026-05-31 — v2.5.0

本日完成第二优先级全部 4 项产品感优化 + Per-Project Agent 配置 + 第三优先级全部 5 项 MRF 架构演进能力（DET/动态Agent/ContextDB/AgentTree/Checkpoint）。

### v2.5.0 — 产品感提升 + Per-Project Agent 配置 + MRF 架构演进

**完成内容**:

1. **Per-Project Agent 配置**
   - `ProjectData`（Server）和 `Project`（Client）新增 `enabledAgentIds?: string[]` 字段
   - undefined 表示全部启用，空数组表示全部禁用，向后兼容
   - `GET/PUT /api/projects/:id/enabled-agents` API 端点
   - AgentsPanel 新增 `ProjectAgentConfig` 组件（Switch 开关逐个控制）
   - RunDetail 根据 `currentProject.enabledAgentIds` 过滤 agents 列表传入 NodeDetailPanel
   - 保存后调用 `setProjects()` 同步全局 Store

2. **Agent 输出 Markdown 渲染**
   - 审批面板嵌入 AgentResultPreview 组件
   - react-markdown + remark-gfm 渲染 Markdown
   - react-syntax-highlighter + oneDark 主题代码高亮
   - MD/TXT 模式切换、一键复制、展开/收起

3. **DAG 图形化可视化**
   - 引入 `@xyflow/react` 替代垂直列表
   - 拓扑分层自动布局，并行分支一目了然
   - 自定义 DAGCustomNode 组件显示状态、角色、计时、产出物
   - 边线根据节点状态着色（已完成绿色、活跃紫色动画、未激活灰色）
   - 支持拖拽平移和鼠标滚轮缩放

4. **Run Overview 信息增强**
   - 渐变色进度条（完成/失败/进行中三色态）
   - 当前阶段指示器（执行中/待验收/就绪）
   - 完成率、活跃 Agent 数（带动画）、总耗时

5. **多 Provider 配置面板**
   - ProviderConfigPanel 组件（Codex/Claude/自定义 CLI 三大 Provider）
   - 可用性检测、默认配置预览、环境变量配置（password 类型）、启用/禁用开关

6. **动态 Agent 创建（MRF §6.3）**
   - `dynamic-agent-factory.ts` — 节点执行前按角色 + context 动态创建 Agent 实例
   - 生命周期跟随 Run，执行结束自动回收
   - 支持 planner / manager / executor 三角色

7. **Context DB 基础版（MRF §8）**
   - `context-db.ts` — SYS/L0/L1/L2 四层上下文文件 CRUD + 装配引擎
   - `ContextDBPanel.tsx` — 层级 Tab、文件列表、在线编辑器、装配预览
   - 支持按项目/模板/节点粒度组织上下文

8. **Agent Tree 可视化（MRF §4.6）**
   - `AgentTreePanel.tsx` — Run 内动态 Agent 实例的树形展示
   - 按角色（planner/manager/executor）分组，显示实例状态、关联节点、创建时间
   - 支持展开/收起和刷新

9. **Checkpoint 恢复 UI（MRF §2.5）**
   - `CheckpointPanel.tsx` — Timeline 展示快照列表
   - 支持手动创建快照、恢复到指定 Checkpoint（含确认弹窗）
   - 系统健康状态监控面板（死信队列/待重试/总快照数/审计日志）

10. **确定性执行层 DET 模式（MRF §2.1）**
    - `AgentService.executeDET()` + `spawnDETProcess()` — 子进程直接执行脚本命令
    - DET 模式成功自动 completed（不需人工审批），失败标记 failed
    - HYB 混合模式：先执行脚本，失败自动回退到 LLM Agent
    - 前端节点详情：执行模式标签（⚡ DET / 🔄 HYB），DET 不需用户输入、不需选择 Agent
    - 5 分钟超时保护，超时自动终止进程

**修复的问题**:
- **"保存失败" HTML 错误响应**：Server 代码更新后未重启 → 重启 Server 解决
- **Agent 下拉未同步过滤**：RunDetail 未基于项目配置过滤 agents → 添加 filtering 逻辑
- **Store 未同步**：AgentsPanel 保存后未更新全局 Store → 添加 `setProjects()` 调用
- **DAG 节点点击无反应**：改用 ReactFlow onNodeClick 回调

---

## 2026-05-30 — v2.4.1 → v2.4.3

本日完成工程质量提升、第一优先级体验优化、以及实时性 Bug 修复。

### v2.4.3 — 实时性修复（WS 事件广播 + Token 持久化）

**完成内容**:
- 修复审批后需刷新才能看到下一节点的 Bug：computeReadyNodes 状态变更时广播 WS 事件
- Agents 页面 Token 统计改为从后端 API 拉取持久化数据，刷新不丢失

### v2.4.2 — 体验优化（节点计时器 + 审批交互 + Token 统计面板）

**完成内容**:
- 节点实时计时器：running 时显示秒表（每秒刷新），completed 后显示总耗时
- 审批交互「修改后继续」按钮：用户填写修改意见后 approve，意见通过 Context Chaining 传递
- Token 统计面板：修复 parseTokenUsage 正则匹配，Run 头部新增 Token 累计统计徽章
- 新增 OPTIMIZATION-TODO.md（12 项 MRF 对标优化清单）

### v2.4.1 — 工程质量提升

**完成内容**:

1. **路由级代码分割**
   - 所有 5 个路由页面（Home/Project/RunDetail/Changelog/About）改为 `React.lazy()` 动态导入
   - 新增 `SuspenseWrapper` 组件统一包裹 lazy 路由
   - 新增 `RouteLoadingFallback` 组件提供加载中 UI
   - 构建产物从单一 ~1.1MB chunk 拆分为 845KB 主包 + 独立页面 chunk

2. **React ErrorBoundary**
   - 新增 `components/common/ErrorBoundary.tsx`（class 组件，getDerivedStateFromError）
   - 包裹在 AppLayout 的 `<Outlet />` 外层，捕获页面级崩溃
   - 提供友好错误 UI + 重试按钮，开发环境额外显示错误堆栈

3. **useRequest Hook**
   - 新增 `hooks/useRequest.ts`
   - `useRequest`：完整版，内置 loading 状态、成功/失败 Toast、指数退避重试（可配置最大次数和延迟）
   - `useLoadingAction`：轻量版，仅包含 loading + try/catch 包裹

4. **Vitest 单元测试**
   - 新增 `packages/server/vitest.config.ts`
   - 新增 `packages/server/tests/` 目录，包含三个测试文件：
     - `workflow-engine.test.ts`（26 cases）：Run/Node 生命周期、Turn 管理、拓扑排序
     - `a2a-protocol.test.ts`（26 cases）：消息收发、Channel、broadcast、retry/fail
     - `contract-validator.test.ts`（16 cases）：format 匹配、验证报告
   - 共 68 个测试用例，全部通过
   - `package.json` 添加 `test` / `test:watch` / `test:coverage` 脚本

**遇到的问题**:
- Vitest 在 Node 16 下报错 `styleText is not exported from node:util` → 需要 Node 20+（`nvm use 20`）
- 构建后 vendor chunk（antd）仍有 500KB+ 警告 → 预期行为，页面 chunk 已独立拆分

**新增文件**:
- `packages/client/src/components/common/RouteLoadingFallback.tsx`
- `packages/client/src/components/common/ErrorBoundary.tsx`
- `packages/client/src/hooks/useRequest.ts`
- `packages/server/vitest.config.ts`
- `packages/server/tests/workflow-engine.test.ts`
- `packages/server/tests/a2a-protocol.test.ts`
- `packages/server/tests/contract-validator.test.ts`

---

## 2026-05-30 — v2.4.0

本日聚焦 MAF 架构四大缺失能力的实现 + 健壮性全面增强。

### v2.4.0 — MAF 六大服务模块

**新增 6 个服务模块**（共 ~1500 行新代码）：

1. **RepoIsolationService** (`repo-isolation.ts`)
   - Git worktree 池化管理，支持 worktree / symlink / copy 三种策略
   - Run 级隔离：每个 Run 获得独立工作目录，防止并行冲突
   - 自动回收：Run 结束后归还 worktree，dispose 时清理全部

2. **SkillMaterializationService** (`skill-materialization.ts`)
   - 白名单/黑名单模式：按 agentRole 或 nodeType 控制 Skill 可见性
   - 运行时物化：Skill 文件复制到节点工作目录 `.skills/`
   - TTL 缓存：相同配置在 TTL 窗口内直接复用

3. **PermissionIsolationService** (`permission-isolation.ts`)
   - RBAC 策略：AgentPermissionPolicy 按角色定义仓库和文件访问规则
   - 双层校验：仓库级 glob + 文件级 glob（read/write/execute）
   - Deny-by-default + 审计日志

4. **A2AProtocolService** (`a2a-protocol.ts`)
   - 优先级收件箱：high > normal > low 排序
   - 消息类型：request / response / delegate / broadcast
   - ACK + resolve 确认机制，Channel 管理，过期清理
   - Legacy InboxItem bridge 兼容旧系统

5. **ContractValidatorService** (`contract-validator.ts`)
   - 按 category 精确匹配 + format 兼容性矩阵
   - 验证报告：matched / missing / extra / overall pass/fail

6. **RobustnessService** (`robustness.ts`)
   - 指数退避重试（configurable maxAttempts + backoffFactor）
   - 死信队列（DLQ）：超限任务保留完整上下文
   - Checkpoint 快照：关键时刻保存 Run/Node/Agent 状态
   - 审计日志：全操作带时间戳记录 + JSON 导出

**类型扩展**（`types/index.ts`）：新增 ~220 行类型定义覆盖 RepoPool、MaterializedSkill、AgentPermissionPolicy、A2AMessage、ContractValidationResult、RetryPolicy、DeadLetterItem、Checkpoint、AuditLogEntry 等

**API 路由扩展**（`routes/api.ts`）：新增 ~230 行路由，涵盖 repo-pool、a2a、permissions、contracts、robustness、skill-materialization 六组端点

**服务入口更新**（`index.ts`）：v2.4.0 版本号，所有新服务实例化 + DI 注入 + graceful shutdown 挂载

**编译修复**：解决所有 TS6133/TS6196 未使用变量/导入错误，最终 `tsc --noEmit` 零错误通过

---

## 2026-05-30 — v2.3.0 → v2.3.1

本日主要围绕 Code Review 反馈进行安全加固、架构增强和模板补全。

### v2.3.1 — 工作流模板完善 & 异步安全修复

**完成内容**:
- 三个轻量模板（quick-feature / bug-fix / parallel-dev）补充缺失的「交付汇总」(deliver) 节点
- 三个轻量模板所有节点补充 outputContracts 产出物合同定义
- auto-execute 端点修复：启动 Agent 前先调用 `startNode()` 将节点从 ready → running
- 路由层所有调用 async WorkflowEngine 方法的 handler 统一加上 async/await
- `deleteRun` 方法改为 async 并 await persist()
- 健康检查版本号从遗留的 2.0.0 更新为 2.3.1

**发现的问题**:
- Vite dev server 重启后端口从 5173 变为 5174 → 原因是旧进程未完全释放端口，Vite 自动递增
- `tsx watch` 热更新仅监听 server 代码，client 依赖 Vite HMR，需清除 `.vite` 缓存后重启

### v2.3.0 — 安全加固 & DAG 增强 & AI 开发流程优化

**完成内容**:

安全修复：
- WebSocket ManagedWS 模式（dispose 标志位防止递归重连泄漏）
- cancelTurn 引入 cancelledTurns Set 防止 close handler 重复提交
- persist() 所有状态变更方法改为 async/await 防数据丢失
- OAuth state CSRF 防护（随机 state + 10 分钟 TTL）
- 文件系统 API allowedRoots 路径穿越防护

稳定性增强：
- NodeDetailPanel key={selectedNode.id} 强制重挂载解决状态残留
- 启动时自动检测并重置孤儿 running 节点

DAG 编排增强：
- EdgeCondition 条件分支（status / output_contains / expression）
- Context Chaining：buildNodeContext 自动聚合前置节点的 Turn 输出和产出物
- RunConfig autoExecute / maxParallel 并行执行配置
- /auto-execute API 批量启动所有 ready 节点

AI 开发流程优化：
- Agent 输出结构化解析（提取代码块、JSON 产出物 → Artifact）
- Prompt 模板化 {{变量}} 语法（内置 + 自定义变量）
- Token 消耗追踪与成本统计（按 Run/Node 粒度）
- Git 集成（GitService：仓库状态、commit 列表、diff 获取）
- Skill 智能推荐引擎（关键词匹配 + 节点类型评分）

---

## 2026-05-29 — 从零到 v2.2

整个项目在今天下午一个会话内从零搭建完成，经历了四个主要版本迭代：

### v2.2.0 — 后端服务状态监测 & GitHub Pages 部署

**完成内容**:
- 后端健康检测系统：前端 useServerStatus Hook 每 10 秒轮询 /health
- 侧边栏实时状态指示器（绿色/蓝色脉动/红色三态）
- 离线横幅含完整启动命令
- gh-pages 一键部署 GitHub Pages
- Skills 扫描支持 CatPaw / Claude / Codex 三套工具的全局和项目级目录

### v1.0.0 — 项目初始化 & 基础框架

**完成内容**:
- Monorepo 搭建（npm workspaces: packages/client + packages/server）
- 前端：React 19 + Vite 8 + Tailwind CSS v4 + Ant Design 6 + Zustand 5
- 后端：Express 5 + WebSocket (ws) + tsx 热更新
- 项目 CRUD 功能（创建/删除/列表）
- Sidebar + 项目详情面板基础 UI
- 数据持久化到 ~/.agent-flow/*.json

**遇到的问题**:
- Tailwind CSS v4 的 `space-y-*` 与 Ant Design 冲突 → 改用 `flex flex-col gap-*`
- 卡片间距不符合预期 → 调整 padding 和 gap 值

### v2.0.0 — MAF 工作流引擎 MVP

**完成内容**:
- DAG 编排引擎实现（三层状态机：Run → Node → Turn）
- 多角色 Agent 系统（Planner/Manager/Executor）
- Agent Turn 生命周期管理（启动/流式输出/完成/取消）
- WebSocket 实时推送 Agent 输出
- 结构化产出物（Artifacts）交付
- Codex CLI / Claude CLI 集成
- 工作流模板管理（4 个内置模板）
- Skills 扫描与管理（扫描 .catpaw/skills 目录）
- Run 详情页：DAG 视图 + 节点操作（启动/审批/打回/跳过/回滚/强制重置）
- Agent 面板：显示可用 Agent 状态
- 任务日志面板：实时展示操作记录

**遇到的问题**:
- Node.js 16 无法运行 Vite 8 → 需要 nvm use 20
- Token 统计需从 Agent 进程 stdout 解析 → 通过 turn_completed 事件推送

### v2.1.0 — 企业级路由 & GitHub 集成

**完成内容**:
- React Router Dom v7 企业级路由架构
  - `createBrowserRouter` + `basename: '/agent-flow'`
  - 路由：/ → /projects/:id/:tab → /projects/:id/runs/:runId → /changelog → /about
  - AppLayout 作为根布局组件（Sidebar + Outlet）
- Zustand Store 重构：移除所有路由相关状态，仅保留业务数据
- GitHub OAuth 2.0 后端实现（AuthService）
  - 授权码流程 → access_token → 用户信息
  - 会话持久化到 ~/.agent-flow/auth.json
- 前端 Auth API 客户端
- UserPanel 组件（Sidebar 底部，登录/用户信息/登出）
- ChangelogPage（时间线样式更新日志）
- AboutPage（完整项目文档：定位/架构/功能/使用方法）
- Vite HMR 修复（hmr.path: '/__vite_hmr' 避免与 /ws 代理冲突）
- .agent-flow/context/ 上下文文档体系

**遇到的问题**:
- Sidebar 中 `useParams()` 获取不到子路由参数 → 因为 Sidebar 在父路由渲染，改用 `useLocation().pathname` 正则提取
- 用户反馈"默认项目没了" → 实际数据正常（2 个项目在 projects.json），是 Sidebar useParams bug 导致没有高亮选中项目
- 更新日志日期错误 → 所有版本都是今天（2026-05-29）完成的

### 删除的文件

- `src/App.tsx` — 被 AppLayout + RouterProvider 取代
- `src/components/detail/ProjectDetail.tsx` — 被 ProjectPage 路由页面取代

### 代码统计

- 前端源文件：约 25 个
- 后端源文件：约 10 个
- 总模块数（Vite build）：3227 个（含依赖）
- 生产构建体积：~1.1MB（gzip ~345KB）
