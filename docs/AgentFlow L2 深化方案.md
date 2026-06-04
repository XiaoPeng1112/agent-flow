现在我有了足够的信息来设计完整方案。让我基于系统现有架构深入思考。
现在我对系统有了全面且细致的理解，可以输出完整方案了。

---

## AgentFlow L2 深化方案：从"高频签字的经理"到"真正脱手的老板"

---

### 核心命题

当前系统已具备 L2 骨架（DAG 编排 + 多角色 Agent + 产出物闭环），但人的介入频率过高——每个节点完成后都进入 `wait_user_review` 等人 approve。L2 的终极形态应该是：**Agent 团队自主完成 80% 节点的验证和流转，人仅在关键决策点介入。**

这份方案围绕一个核心问题展开：**如何让系统判断"这个节点不需要人看"并自动放行？**

---

### 一、自主流转引擎（AutoFlow Engine）

#### 1.1 设计思路

当前流程：Agent 执行完成 → 一律进入 `wait_user_review` → 人 approve → 下一节点

目标流程：Agent 执行完成 → **AutoFlow 评估** → 通过则自动 approve 并流转 → 不通过才暂停等人

这是整个方案中最核心的改动，它改变的不是一个模块，而是节点状态机的流转逻辑。

#### 1.2 节点置信度模型（Node Confidence）

每个节点完成后，系统自动计算一个**置信度分数**（0-100），决定是否自动放行：

```typescript
// 新增文件：packages/server/src/services/auto-flow.ts

interface ConfidenceSignal {
  name: string
  score: number      // 0-100
  weight: number     // 权重
  reason: string
}

interface AutoFlowDecision {
  nodeId: string
  confidence: number           // 综合置信度
  signals: ConfidenceSignal[]  // 各项评估信号
  decision: 'auto_approve' | 'require_review'
  reason: string
}
```

**置信度评估维度（与现有系统对接点）：**

| 信号 | 对接现有模块 | 计算逻辑 |
|------|-------------|---------|
| OutputContract 满足度 | ContractValidatorService | 所有 required contract 满足 → +30 分 |
| Exit Condition 通过 | DAGScheduler.evaluateExitConditions | 全部通过 → +20 分 |
| Agent 执行状态 | AgentService（exit code） | code=0 且无 timeout → +15 分 |
| 历史一次通过率 | MetricsCollector（同模板同节点） | 历史通过率 > 80% → +15 分 |
| 代码质量信号 | exitCondition 中的 lint_pass/test_pass | lint + test 通过 → +20 分 |
| 无变更冲突 | RepoIsolationService | merge-base 无冲突 → +10 分（仅代码节点） |

**自动放行阈值：** 由 RunConfig 控制，默认 75 分。

#### 1.3 与现有状态机的融合

当前 `submitNodeDecision` 的逻辑是：Agent 完成 → 直接标记为 `wait_user_review`。改动点集中在这一处：

```
// RunManager.submitNodeDecision 中，原逻辑：
case 'waiting_user_review':
  node.status = 'wait_user_review'

// 新逻辑：
case 'waiting_user_review':
  const autoFlowResult = this.autoFlowEngine.evaluate(run, node)
  if (autoFlowResult.decision === 'auto_approve') {
    // 直接走 approve 路径
    node.status = 'completed'
    node.completedAt = Date.now()
    this.dagScheduler.computeReadyNodes(run)
    this.checkRunCompletion(run)
    this.emit('run:node_auto_approved', { runId, nodeId, confidence: autoFlowResult.confidence })
  } else {
    node.status = 'wait_user_review'
    // 将评估理由附到节点上，供前端展示
    node.autoFlowResult = autoFlowResult
  }
```

#### 1.4 RunConfig 扩展

在现有的 RunConfig 基础上新增 AutoFlow 配置项：

```typescript
interface RunConfig {
  // ... 现有字段 ...
  autoFlow?: {
    enabled: boolean                  // 总开关
    threshold: number                 // 自动放行阈值（默认 75）
    alwaysReviewNodes?: string[]      // 强制人工 review 的节点类型/ID
    neverReviewNodes?: string[]       // 跳过 review 的节点类型
    maxConsecutiveAutoApprove?: number // 连续自动放行上限（防止失控）
  }
}
```

**安全保障设计：**
- `alwaysReviewNodes` 默认包含 `['specify', 'design', 'deliver']`——需求确认、架构设计、最终交付永远要人看
- `maxConsecutiveAutoApprove` 默认 3——连续自动放行 3 个节点后，下一个强制人工 review
- 置信度低于 50 分时，即使配置为 neverReview 也强制暂停

---

### 二、Agent 自主验证层（Self-Validation）

#### 2.1 问题

当前 Agent 执行完就结束了，"活干得好不好"完全由人判断。L2 模式下 Agent 应有自验能力。

#### 2.2 验证 Turn 机制

在 Agent 完成主执行 Turn 后，系统自动追加一个**验证 Turn**（Validation Turn），使用同一 Agent 或专门的 reviewer Agent 来检查产出物质量。

```typescript
// AutoFlowEngine 中的验证流程

async validateNodeOutput(run: Run, node: TaskNode): Promise<ValidationResult> {
  // 1. 如果节点有 outputContracts，先做结构化校验
  const contractResult = this.contractValidator.validateNode(node, templateContracts)
  
  // 2. 如果节点是代码类型，运行 exitCondition 中定义的检查
  //    复用现有 DET 模式执行 lint/test 脚本
  if (node.executionMode === 'det' || node.exitConditions?.some(c => c.type === 'test_pass')) {
    const testResult = await this.runValidationScript(node)
  }
  
  // 3. 对于文档类节点（specify/design），可选用 LLM 做内容审查
  //    但这一步是可选的（成本考虑），通过 RunConfig.autoFlow.useLLMValidation 控制
  if (this.shouldUseLLMValidation(node)) {
    const reviewTurn = await this.spawnValidationTurn(node)
  }
}
```

#### 2.3 与现有 DET/HYB 模式的融合

当前 `executionMode` 已有 `det`（确定性脚本）和 `hyb`（先脚本后 LLM）。验证 Turn 复用这个机制：

- 代码节点：验证脚本 = `npm test` / `npm run lint`（从 node.exitConditions 或 RunConfig 中获取）
- 设计节点：验证 Turn = 使用 manager 角色 Agent，给它上一步的产出物 + 验证 prompt（"检查这份设计文档是否覆盖了需求中的所有场景"）

这不需要新建一个大模块，只需要在 `submitNodeDecision` 前插入一个异步验证步骤。

---

### 三、反馈闭环注入（Feedback-to-Context）

#### 3.1 问题

当前 FeedbackCollector 只做记录，reject 原因不会回流到后续执行中。同一个 Agent 可能在同类任务上反复犯同样的错。

#### 3.2 设计：历史 Reject 自动注入 L2 Context

在 DynamicAgentFactory 的 7 步 prompt 装配中（Step 5.5 之后），新增 Step 6：**历史反馈注入**。

```typescript
// DynamicAgentFactory.buildFullPrompt 中新增

// Step 6: Historical Feedback Injection
const historicalFeedback = await this.feedbackCollector.query({
  type: 'review_reject',
  runId: undefined,  // 不限定 Run，查全局同类节点
  limit: 5,
})

// 筛选与当前节点同名/同类型的历史 reject
const relevantFeedback = historicalFeedback.filter(fb => 
  fb.nodeName === node.name || fb.context?.nodeType === node.type
)

if (relevantFeedback.length > 0) {
  sections.push({
    label: '⚠️ 历史经验教训（过往打回原因）',
    content: relevantFeedback.map(fb => 
      `- ${fb.summary}: ${fb.details}`
    ).join('\n')
  })
}
```

#### 3.3 与 ContextDBService 的融合

另一个路径是将高频 reject 原因自动写入 L1 Context（模板级），这样不仅当次 Run 能看到，后续所有使用同一模板的 Run 都能学到教训。

触发条件：同一节点名被 reject 3 次以上，自动将 reject 原因总结后追加到对应模板的 L1 context 文件中。这利用了现有的 `contextDBService.upsertFile('L1', scopeId, filename, content)` 接口。

---

### 四、Manager Agent 自主调度（Agent Orchestration）

#### 4.1 问题

当前系统中 DAG 流转是由代码逻辑驱动的（`computeReadyNodes` + `startNode`），不存在一个"管理者 Agent"在运行时做调度决策。但 AgentService 中已注册了 `manager` 角色的 Agent，且 A2A Protocol 也预留了 `delegated_task` 消息类型——基础设施已经就绪，缺的是触发机制。

#### 4.2 RunOrchestrator：调度策略层

新增一个轻量的编排策略层（不是新的大模块，是在现有 onEvent 回调中增加逻辑）：

```typescript
// 在 index.ts 的 workflowEngine.onEvent 回调中

if (message.type === 'run:node_updated' && status === 'ready') {
  const run = workflowEngine.getRun(runId)
  const node = run?.nodes.find(n => n.id === nodeId)
  
  if (run?.config?.autoFlow?.enabled && node) {
    // 自动启动 ready 节点（无需人手动点击 "Start"）
    await autoStartNode(run, node)
  }
}
```

`autoStartNode` 的逻辑：

1. 如果节点有 `executionMode === 'det'`，直接执行脚本（确定性任务无需 Agent）
2. 如果节点配置了 `preferredAgentId`，使用指定 Agent
3. 否则，使用 DynamicAgentFactory 根据节点类型自动选择 Agent 并执行

这意味着：**一旦 Run start 后，整条 DAG 管线可以自动推进**——ready 即启动、完成即验证、通过即流转，直到遇到需要人 review 的节点才暂停。

#### 4.3 并行执行优化

现有 `computeReadyNodes` 已经支持多节点同时 ready（DAG 中无依赖关系的节点）。在 autoStart 模式下，多个 ready 节点应并行启动：

```typescript
// 一次 computeReadyNodes 可能标记多个节点为 ready
// autoStartNode 对每个 ready 节点异步启动，不互相阻塞
const readyNodes = run.nodes.filter(n => n.status === 'ready')
await Promise.all(readyNodes.map(node => autoStartNode(run, node)))
```

这自然利用了 RepoIsolationService 的 worktree 隔离——每个 Agent 在独立工作分支上工作，互不干扰。

---

### 五、端到端运行模式（E2E Mode）

#### 5.1 用户体验变化

当前用户交互：创建 Run → 手动 Start → 等 Agent 完成 → Review → Approve → 下一节点 → 重复...

L2 理想交互：创建 Run → **一键启动** → 系统自主推进 → **仅在关键节点通知用户 Review** → 最终交付

#### 5.2 实现路径

将上述 1-4 组合起来，形成完整的 E2E 运行模式：

```
用户 startRun(runId) 
  → computeReadyNodes → 发现 specify 节点 ready
  → autoStartNode(specify) → Agent 执行
  → Agent 完成 → AutoFlow 评估
  → specify 节点类型在 alwaysReviewNodes 中 → 暂停，通知用户
  
用户 approveNode(specify)
  → computeReadyNodes → design 节点 ready
  → autoStartNode(design) → Agent 执行
  → Agent 完成 → AutoFlow 评估
  → design 在 alwaysReviewNodes 中 → 暂停，通知用户

用户 approveNode(design)
  → computeReadyNodes → implement + test 节点都 ready（并行）
  → autoStartNode(implement) + autoStartNode(test)
  → implement 完成 → 自验 (lint pass + contract 满足) → 置信度 85 > 75 → 自动 approve
  → test 完成 → 自验 (test pass) → 置信度 90 > 75 → 自动 approve
  → computeReadyNodes → deliver 节点 ready
  → autoStartNode(deliver) → Agent 执行
  → deliver 在 alwaysReviewNodes 中 → 暂停，通知用户

用户 approveNode(deliver) → Run completed
```

在这个流程中，用户只需要 3 次 approve（specify、design、deliver），而不是 5 次。implement 和 test 阶段完全脱手。

---

### 六、通知与透明度（Notification Layer）

#### 6.1 为什么需要

如果系统自主运行，用户需要知道"什么时候该看了"和"系统自己做了什么决策"。

#### 6.2 通知策略

复用现有 WebSocket 事件系统，新增事件类型：

```typescript
// 新增 WsMessage 类型
| 'run:node_auto_approved'    // 节点被自动放行
| 'run:waiting_human_review'  // 需要人介入
| 'run:auto_flow_blocked'     // 自动流转被阻断（置信度不足）
```

前端 Store 新增处理：

```typescript
case 'run:waiting_human_review':
  // 浏览器 Notification API + 声音提示
  get().appendTaskLog(`⏸️ 节点「${payload.nodeName}」需要您的审批`, 'warning')
  break

case 'run:node_auto_approved':
  get().appendTaskLog(`✅ 节点「${payload.nodeName}」自动通过 (置信度 ${payload.confidence}%)`, 'success')
  break
```

#### 6.3 决策追溯面板

在前端 RunDetail 中新增一个 "AutoFlow Log" Tab（或整合到现有 TaskLogBar），展示每个节点的自动决策过程：

```
[14:32:05] 🤖 implement 节点完成，开始 AutoFlow 评估
  ├─ OutputContract: 2/2 满足 → +30
  ├─ lint_pass: 通过 → +20
  ├─ exit_code: 0 → +15
  ├─ 历史通过率: 87% → +15
  └─ 总分: 80 ≥ 阈值 75 → 自动放行 ✓
[14:32:06] ✅ implement 节点自动 approve，推进下游节点
```

---

### 七、实施路线图

按依赖关系和价值排序：

**Phase 1（基础能力，1 周）**

1. 新增 `AutoFlowEngine` 服务，实现置信度评估框架
2. 扩展 `RunConfig` 加入 `autoFlow` 配置
3. 修改 `RunManager.submitNodeDecision` 加入 AutoFlow 判断分支
4. 新增 `run:node_auto_approved` 事件，前端 TaskLog 支持展示

**Phase 2（自动推进，1 周）**

5. 实现 ready 节点自动启动（onEvent 回调中监听 `run:node_updated` ready 状态）
6. 并行节点并发执行
7. `maxConsecutiveAutoApprove` 安全阀实现
8. 前端 RunConfig 编辑面板新增 AutoFlow 开关

**Phase 3（自验能力，1-2 周）**

9. 代码节点验证脚本执行（复用 DET 模式）
10. 文档节点可选 LLM 验证 Turn
11. 验证结果作为置信度信号接入 AutoFlowEngine

**Phase 4（反馈闭环，1 周）**

12. Feedback-to-Context 注入（DynamicAgentFactory Step 6）
13. 高频 reject 自动沉淀到 L1 Context
14. WeeklyDigest 增加"自动放行准确率"指标

---

### 八、与现有架构的兼容性

| 改动点 | 影响范围 | 侵入性 |
|--------|---------|--------|
| 新增 AutoFlowEngine 服务 | 新文件，index.ts 注入 | 零侵入现有模块 |
| RunManager.submitNodeDecision 分支 | 单处修改（~15 行） | 低侵入，保持原路径为 fallback |
| RunConfig 扩展 | types + StorageSQLite schema | 向后兼容，新字段可选 |
| onEvent 回调新增 autoStart | index.ts 中增加逻辑 | 独立于现有逻辑 |
| DynamicAgentFactory 注入反馈 | buildFullPrompt 末尾追加 | 纯追加，不改现有步骤 |
| 前端 Store 新增事件处理 | appStore.ts handleWsMessage | 新 case 分支 |

整体设计原则：**AutoFlow 是一个叠加层而非替代层**。关闭 `autoFlow.enabled` 后系统回退到当前行为，每个节点都等人 review。这确保了方案的渐进式可控性。

---

### 九、量化目标

| 指标 | 当前 | Phase 1-2 后 | Phase 3-4 后 |
|------|------|-------------|-------------|
| 人均 Review 次数 / Run | N（=节点数） | N × 0.4（60% 自动） | N × 0.25（75% 自动） |
| 平均 Run 端到端时间 | 高（人工瓶颈） | 降低 40%（减少等待） | 降低 60% |
| Agent 重复犯错率 | 无管控 | 无变化 | 降低 50%（反馈注入） |
| 人类干预质量 | 审批疲劳 | 聚焦高价值决策 | 仅在真正需要判断时介入 |

---

这份方案的核心逻辑是：**不是让 Agent 更聪明，而是让系统有能力判断"够不够好"——够好就自动过，不够好才找人。** 这把人从"流水线签字员"变成了"质量标准制定者"，真正实现 L2 的管理者定位。