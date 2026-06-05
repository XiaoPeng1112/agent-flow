# AgentFlow 全系统审计报告

> 审计时间：2026-06-04  
> 当前版本：v2.9.1  
> 覆盖范围：v1.0 → v2.9.1 所有历史版本功能

---

## 一、系统架构总览

AgentFlow 是一个 AI 驱动的多 Agent 协作开发工作流平台，采用前后端分离架构：

- **后端**：Express + WebSocket + SQLite（WAL 模式），33 个服务模块
- **前端**：React 19 + Zustand + Ant Design + ReactFlow，7 个页面 + 21 个面板组件
- **通信**：REST API（94 个方法）+ WebSocket 实时事件推送
- **部署**：GitHub Pages（前端）+ Node.js 服务（后端）

---

## 二、核心引擎层（v1.0 → v2.0）

### WorkflowEngine（Facade 模式，269 行）

委托给三个子服务：

- **RunManager（641 行）**：Run CRUD + 节点 7 态状态机（pending → ready → running → wait_user_review → completed/failed/skipped），SQLite+WAL 持久化，孤儿 Run 恢复
- **DAGScheduler（355 行）**：`computeReadyNodes()` 基于拓扑排序，支持 entryConditions / exitConditions / 条件边 / Context Chaining
- **TurnManager**：Turn 生命周期管理

**结论**：核心引擎逻辑完整，状态流转覆盖所有边界情况，持久化可靠。

---

## 三、Agent 系统（v1.0 → v2.9.1）

### AgentService（1705 行）

- Agent Turn 执行核心
- stdout 流式输出推送（WebSocket 实时广播）
- `reportProgress` 15s 节流
- 自动触发对抗审查
- 任务交付 A2A 消息

### DynamicAgentFactory（758 行）

- 运行时创建 Agent 实例
- 自动装配 4 层 Context DB（SYS → L0 → L1 → L2）
- 智能匹配节点角色对应的最佳 Agent
- 支持跨角色回退

### AdversarialTurnService（1011 行）

- coder → reviewer → fix 多轮对抗循环
- Sub-Turn 结构化管理
- 最大轮次限制 + 质量分数评估

**结论**：Agent 执行链路完整，从创建实例到执行到输出到对抗审查，全流程事件驱动且可观测。

---

## 四、持久化层（v1.5 → v2.5）

### StorageSQLite（614 行）

- SQLite + WAL 模式
- JSON → SQLite 一次性自动迁移
- 多表设计（projects、runs、templates、context_files、sync_state 等）

### ContextDB（1117 行）

- 4 层上下文体系：SYS（全局规则）→ L0（项目级）→ L1（模板级协作协议）→ L2（节点运行时）
- 文件系统存储，按需装配注入到 Agent prompt
- 前端独立编辑页面（ContextDBSysPage / ContextDBL1Page）

**结论**：持久化设计合理，迁移机制平滑，Context DB 分层清晰。

---

## 五、可观测性（v2.3 → v2.7）

### MetricsCollector（531 行）

- 节点级 Token 消耗、执行耗时、工具调用次数、文件修改统计
- 趋势对比和效率分析

### FeedbackCollector（423 行）

- 5 类反馈采集：审批打回、执行失败、验证失败、Diff 丢弃、手动备注
- 按天存储

### WeeklyDigest

- 聚合 7 天数据生成周报
- Agent 绩效排名、趋势分析、异常检测、信号健康度报告

**结论**：数据链路完整，从采集到聚合到展示全覆盖。

---

## 六、AutoFlow 自动放行（v2.5 → v2.9.1）

### AutoFlowEngine（1533 行）

8 信号加权置信度评估：

1. contractSatisfaction
2. exitConditions
3. historicalPassRate
4. outputQuality
5. executionStability
6. mergeConflictFree
7. validationScore
8. adversarialScore

贝叶斯自适应阈值学习。

### AutoStart（index.ts:212-290）

- 节点变为 ready 时自动通过 A2A `delegateTask` 委派并启动执行
- 含并行度限制

### ValidationTurnService（1032 行）

4 种验证策略：script / llm / contract / composite

### L1RuleLifecycleService（930 行）

5 态生命周期：draft → active → decaying → deprecated → archived

**结论**：AutoFlow 是系统最复杂的子系统，信号采集→评估→决策→执行全链路闭环。

---

## 七、产出物体系（v2.0 → v2.8）

### ArtifactMergeService（900 行）

- Git worktree 隔离 → Diff Review → 本地 merge 或 GitHub PR 模式
- 团队仓库自动检测并强制 PR 模式
- 冲突预检测（MergeConflictPanel）

**结论**：代码合入流程企业级完整。

---

## 八、数据同步 + 认证（v2.4 → v2.8）

### SyncService（1185 行）

- GitHub 私有仓库同步
- 多设备路径映射
- 自动脏标记 + debounce 推送
- 启动时自动拉取

### AuthService

- GitHub OAuth 集成 + token 管理

**结论**：同步机制健壮，含冲突检测和静默恢复。

---

## 九、Skill 体系（v2.2 → v2.9.1）

### SkillExtractionService（419 行）

- 5 维评分（通用性、可复用性、复杂度、文档质量、测试覆盖度）
- Jaccard 去重

### SkillMaterializationService（207 行）

- 基于白名单的运行时注入
- 通过评分阈值的 Skill 才被注入到 Agent prompt

**结论**：Skill 从自动沉淀到质量评估到按需注入全自动化。

---

## 十、前端结构完整性

### 路由（8 条）

| 路径 | 页面 |
|------|------|
| `/` | 首页（引导选择项目） |
| `/projects/:projectId/:tab` | 项目详情（runs/workflow/skills/agents/settings） |
| `/projects/:projectId/runs/:runId` | Run 详情 |
| `/changelog` | 更新日志 |
| `/about` | 项目介绍 |
| `/context-db/sys` | Context DB SYS 层编辑 |
| `/context-db/l1` | Context DB L1 层编辑 |

### Run 详情 14 个 Tab

DAG 视图、Diff Review、Metrics、AutoFlow、周报摘要、L1 规则、验证、冲突检测、反馈聚合、Agent Tree、Checkpoint、Context DB、A2A 消息、对抗审查

### DAG 可视化

- 使用 @xyflow/react（ReactFlow）
- 自动拓扑分层布局
- 节点实时状态动画 + 边着色表示执行流

**结论**：前端页面/组件/路由与后端 API 完全对齐，无死路由或缺失面板。

---

## 十一、API 与类型对齐

- **前端 API 模块**：15 个命名空间，94 个 API 方法
- **后端路由**：13 个子路由模块全部挂载
- **类型系统**：前端 `types/index.ts`（394 行）与后端完全对齐

**结论**：前后端类型 100% 对齐，API 覆盖完整无遗漏。

---

## 十二、WebSocket 事件流

后端 WorkflowEngine 事件 → `broadcast()` → 前端 `appStore.handleWsMessage()` 消费：

| 事件 | 前端处理 |
|------|---------|
| `run:status_changed` | 更新 Run 状态 + TaskLog |
| `run:node_updated` | 更新节点状态 |
| `agent:turn_started` | 添加 activeTurn |
| `agent:turn_output` | 追加实时输出（chunk） |
| `agent:turn_completed` | 移除 activeTurn + Token 统计 |
| `agent:turn_paused` | 标记暂停 + 显示提问 |
| `agent:turn_error` | 移除 + 标记错误 |

后端事件同时驱动：MetricsCollector 埋点、Skill 自动沉淀、SyncService 脏标记、AutoStart 自动启动。

**结论**：事件驱动架构完整，关键状态变更实时推送。

---

## 十三、依赖注入链

33 个服务通过构造器注入 + 延迟注入（`inject()` 方法）组织，无循环依赖：

```
WorkflowEngine ← ContextDB（延迟）
AgentService ← WorkflowEngine, AutoFlow（延迟）, Adversarial（延迟）, A2A（延迟）
DynamicAgentFactory ← AgentService, WorkflowEngine, ProjectService, ContextDB, SkillMaterialization, FeedbackCollector（延迟）
AutoFlowEngine ← WorkflowEngine, ContractValidator, Metrics, Feedback, Robustness, Validation, L1, Adversarial
SyncService ← AuthService, ProjectService, WorkflowEngine, TemplateService
WeeklyDigest ← FeedbackCollector, MetricsCollector, AutoFlow（延迟）
```

**结论**：依赖注入链完整且无循环。

---

## 十四、发现的问题

### P3-1：RunDetailPage useEffect 依赖不完整

**位置**：`packages/client/src/pages/RunDetailPage.tsx:31`  
**问题**：`useEffect` 依赖数组缺少 `setRuns`  
**影响**：ESLint 警告，实际不影响运行（Zustand selector 稳定）  
**修复**：补全依赖数组

### P3-2：dev/seed 端点无环境开关

**位置**：`packages/server/src/routes/api.ts:190-310`  
**问题**：Mock seed 端点始终暴露，生产环境不应可用  
**修复**：增加 `NODE_ENV !== 'production'` 开关

### P3-3：WebSocket 重连无退避机制

**位置**：`packages/client/src/api/index.ts:1064`  
**问题**：固定 3s 间隔无限重连，服务长期下线时浪费资源  
**修复**：增加指数退避 + 最大重试次数 + 手动重连按钮

### P2-4：条件路由注册无前端兜底

**位置**：`packages/server/src/routes/api.ts:169-186`  
**问题**：l1-rules/validation/adversarial 使用 `if (deps.xxx)` 条件注册，服务未注入时前端会 404  
**影响**：当前三个服务始终创建故无实际问题，但缺少防御性处理  
**修复**：前端 API 调用增加 404 优雅降级

---

## 十五、历史版本功能演进

| 版本 | 核心新增 |
|------|---------|
| v1.0 | 基础 WorkflowEngine + DAG + Agent + 项目管理 |
| v1.5 | SQLite+WAL 持久化 + JSON 迁移 |
| v2.0 | DynamicAgentFactory + ArtifactMerge + A2A 通信 |
| v2.2 | Skill 物化注入 + 白名单控制 |
| v2.3 | MetricsCollector + FeedbackCollector 可观测 |
| v2.4 | SyncService GitHub 同步 + Auth |
| v2.5 | AutoFlowEngine 8 信号评估 |
| v2.6 | ValidationTurnService 4 策略验证 |
| v2.7 | L1RuleLifecycle 规则生命周期 + WeeklyDigest |
| v2.8 | AdversarialTurn 对抗审查 + PR 自动检测 |
| v2.9.0 | Skill 自动沉淀 + 5 维评分 + AutoStart A2A |
| v2.9.1 | 对抗审查 REST API + SubTurnPanel + reportProgress 节流 |

---

## 十六、总结

AgentFlow 是一个**功能完备、架构清晰、代码质量高**的企业级多 Agent 工作流平台。所有历史版本的功能均已正确集成到当前 v2.9.1 中：

- ✅ 前后端数据流完整
- ✅ 类型安全
- ✅ 事件驱动架构健壮
- ✅ 无阻塞性缺陷（P0/P1 Bug = 0）
- ✅ 4 个 P2/P3 级别改进建议（详见第十四节）

系统从核心调度引擎到可观测性体系，从 Agent 执行到自动化决策，形成了完整的闭环。
