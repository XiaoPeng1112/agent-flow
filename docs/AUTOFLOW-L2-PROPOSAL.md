# AutoFlow Engine — L2 自动化方案设计

> **目标**：将 AgentFlow 从 L1（每个节点都需人工审批）进化为 L2（AI 端到端交付，仅低信心节点需人工介入），将人工干预率从 100% 降低至 ~25%。

---

## 1. 现状分析

### 1.1 系统定位

AgentFlow 已具备完整的 L2 基础设施——三层状态机、DAG 调度、Context Chaining、OutputContract、Entry/Exit Conditions、DynamicAgentFactory 七步 Prompt 装配。但在"节点审批"这一环节上，所有 LLM Agent 完成的节点 **强制进入 `wait_user_review` 状态**（见 `agent.ts:385-389`），构成了 L1 的遗留瓶颈。

### 1.2 关键瓶颈代码

```typescript
// packages/server/src/services/agent.ts:384-389
await this.workflowEngine.submitNodeDecision(
  runId, nodeId,
  wasCancelled ? 'failed' : (code === 0 ? 'waiting_user_review' : 'failed'),
  wasCancelled ? '用户取消执行' : (code !== 0 ? `Agent 退出码: ${code}` : undefined)
)
```

无论 Agent 执行质量多高，一律进入 `waiting_user_review` → 人必须手动 Approve。

### 1.3 已有的"自动完成"先例

DET 模式已经实现了自动完成逻辑（`agent.ts:583`）：

```typescript
// DET 模式：成功直接 completed（不需要人工审批），失败则标记 failed
await this.workflowEngine.submitNodeDecision(
  runId, nodeId,
  wasCancelled ? 'failed' : (code === 0 ? 'completed' : 'failed'),
  ...
)
```

AutoFlow Engine 的本质就是将这种"条件性自动通过"逻辑泛化到所有 LLM Agent 节点。

---

## 2. 核心设计：信心评估 → 自动决策

### 2.1 整体架构

```
Agent 完成
    │
    ▼
AutoFlowEngine.evaluate(run, node, turnResult)
    │
    ├─ 收集信号 → 计算信心分
    │
    ▼
confidence >= threshold?
    │
    ├─ YES → submitNodeDecision('completed')  ← 自动通过
    │
    └─ NO  → submitNodeDecision('waiting_user_review')  ← 人工审核
```

### 2.2 信号体系（ConfidenceSignals）

| 信号 | 来源 | 权重 | 说明 |
|------|------|------|------|
| `exitCode` | Agent 进程退出码 | 前置条件 | code !== 0 → 直接 fail，不进入评估 |
| `contractSatisfaction` | ContractValidatorService | 35% | required contracts 全部满足 = 满分 |
| `exitConditionsPassed` | DAGScheduler.evaluateExitConditions | 25% | 准出条件全部通过 = 满分 |
| `historicalPassRate` | MetricsCollector + FeedbackCollector | 20% | 同 template 同节点位置的历史一次通过率 |
| `outputQuality` | 启发式规则 | 10% | 输出非空、无明显错误关键词、长度合理 |
| `executionStability` | Turn 指标 | 10% | 无超时、无重试、执行时间在合理范围 |

### 2.3 信心分计算公式

```
confidence = Σ(signal_i × weight_i) × 100

其中每个 signal_i ∈ [0.0, 1.0]
```

### 2.4 决策阈值（可配置）

```typescript
interface AutoFlowConfig {
  enabled: boolean              // 总开关
  confidenceThreshold: number   // 0-100，默认 75
  nodeOverrides?: Record<string, {
    enabled?: boolean           // 节点级开关
    threshold?: number          // 节点级阈值覆盖
  }>
}
```

---

## 3. 代码衔接设计

### 3.1 切入点选择（关键设计决策）

**方案：在 `AgentService.spawnAgentProcess` 的 `close` handler 中做决策分流**

原因：
- 不修改 `RunManager.submitNodeDecision` 的语义（保持其职责纯粹）
- 在"决定传什么 decision"的位置做拦截，而非在"处理 decision"的位置
- 与 DET 模式的已有模式对齐（DET 也是在 close handler 中直接决策 `'completed'`）

修改前（`agent.ts:384-389`）：
```typescript
await this.workflowEngine.submitNodeDecision(
  runId, nodeId,
  wasCancelled ? 'failed' : (code === 0 ? 'waiting_user_review' : 'failed'),
  ...
)
```

修改后：
```typescript
// 确定节点决策
let decision: 'waiting_user_review' | 'completed' | 'failed'
if (wasCancelled) {
  decision = 'failed'
} else if (code !== 0) {
  decision = 'failed'
} else {
  // ★ AutoFlow 决策点
  decision = await this.autoFlowEngine.evaluateAndDecide(runId, nodeId)
}

await this.workflowEngine.submitNodeDecision(runId, nodeId, decision, ...)
```

### 3.2 RunConfig 扩展

现有 `RunConfig`（`types/index.ts:27-31`）：

```typescript
export interface RunConfig {
  autoExecute?: boolean
  defaultAgentId?: string
  maxParallel?: number
}
```

扩展为：

```typescript
export interface RunConfig {
  autoExecute?: boolean
  defaultAgentId?: string
  maxParallel?: number
  // ═══ AutoFlow 配置 ═══
  autoFlow?: AutoFlowConfig
}

export interface AutoFlowConfig {
  enabled: boolean                    // 总开关，默认 false（向后兼容）
  confidenceThreshold: number         // 全局阈值，默认 75
  nodeOverrides?: Record<string, {    // key = 节点模板 ID（不含 runId 前缀）
    enabled?: boolean
    threshold?: number
  }>
}
```

持久化方面：`RunConfig` 作为 Run 的 JSON 字段存储在 SQLite 中，无需 schema 变更。

### 3.3 新增服务：AutoFlowEngine

```typescript
// packages/server/src/services/auto-flow-engine.ts

export interface ConfidenceSignals {
  contractSatisfaction: number   // 0.0 - 1.0
  exitConditionsPassed: number   // 0.0 或 1.0
  historicalPassRate: number     // 0.0 - 1.0
  outputQuality: number          // 0.0 - 1.0
  executionStability: number     // 0.0 - 1.0
}

export interface EvaluationResult {
  confidence: number              // 0 - 100
  signals: ConfidenceSignals
  decision: 'auto_approve' | 'require_review'
  reasoning: string               // 人可读的决策解释
}

export class AutoFlowEngine {
  constructor(
    private workflowEngine: WorkflowEngine,
    private contractValidator: ContractValidatorService,
    private metricsCollector: MetricsCollector,
    private feedbackCollector: FeedbackCollector,
  ) {}

  /**
   * 评估并决定节点是否自动通过
   * 
   * 调用时机：Agent 成功完成后（exitCode === 0）
   * 性能要求：同步 or < 50ms（不阻塞 close handler）
   */
  async evaluateAndDecide(
    runId: string,
    nodeId: string,
  ): Promise<'completed' | 'waiting_user_review'> {
    // 1. 检查 AutoFlow 是否启用
    const config = this.getNodeAutoFlowConfig(runId, nodeId)
    if (!config.enabled) return 'waiting_user_review'

    // 2. 收集信号
    const signals = this.collectSignals(runId, nodeId)

    // 3. 计算信心分
    const confidence = this.computeConfidence(signals)

    // 4. 做出决策
    const threshold = config.threshold
    const decision = confidence >= threshold ? 'auto_approve' : 'require_review'

    // 5. 记录审计日志
    this.recordEvaluation(runId, nodeId, { confidence, signals, decision, reasoning: ... })

    // 6. 返回对应的 submitNodeDecision 参数
    return decision === 'auto_approve' ? 'completed' : 'waiting_user_review'
  }
}
```

### 3.4 依赖注入路径

```
index.ts (DI wiring)
  └→ new AutoFlowEngine(workflowEngine, contractValidator, metricsCollector, feedbackCollector)
  └→ agentService.injectAutoFlow(autoFlowEngine)
```

`AgentService` 新增 `injectAutoFlow` 方法（延迟注入，避免循环依赖）。

---

## 4. 信号采集实现细节

### 4.1 contractSatisfaction

```typescript
private getContractSatisfaction(runId: string, nodeId: string): number {
  const run = this.workflowEngine.getRun(runId)
  const node = run?.nodes.find(n => n.id === nodeId)
  if (!node?.outputContracts?.length) return 1.0  // 无 contract 约束 = 满分

  const result = this.contractValidator.validateNode(node, node.outputContracts)
  const requiredContracts = result.results.filter(r => r.required)
  if (requiredContracts.length === 0) return 1.0

  const satisfiedCount = requiredContracts.filter(r => r.satisfied).length
  return satisfiedCount / requiredContracts.length
}
```

### 4.2 exitConditionsPassed

```typescript
private getExitConditionsScore(runId: string, nodeId: string): number {
  const run = this.workflowEngine.getRun(runId)
  const node = run?.nodes.find(n => n.id === nodeId)
  if (!node?.exitConditions?.length) return 1.0  // 无条件 = 满分

  // evaluateExitConditions 在 submitNodeDecision('completed') 时会再次检查
  // 这里预检只是为了给信心分提供信号
  // 注意：直接调用 dagScheduler 会有封装问题，通过 WorkflowEngine 暴露
  // 实际实现中通过 RunManager 的已有调用路径
  return node.exitConditions.every(c => /* check */) ? 1.0 : 0.0
}
```

### 4.3 historicalPassRate

```typescript
private getHistoricalPassRate(runId: string, nodeId: string): number {
  const run = this.workflowEngine.getRun(runId)
  const node = run?.nodes.find(n => n.id === nodeId)
  if (!node) return 0.5  // 默认中性

  // 查询同 template 的历史运行
  const allRuns = this.workflowEngine.getRuns()
  const sameTemplateRuns = allRuns.filter(r =>
    r.templateId === run.templateId && r.id !== runId && r.status === 'completed'
  )

  if (sameTemplateRuns.length === 0) return 0.5  // 无历史 = 中性值

  // 找同位置节点的一次通过率
  const nodeOrder = node.order
  let passCount = 0
  let totalCount = 0

  for (const histRun of sameTemplateRuns) {
    const histNode = histRun.nodes.find(n => n.order === nodeOrder)
    if (histNode?.status === 'completed') {
      totalCount++
      // 通过 MetricsCollector 查询是否一次通过
      const metrics = this.metricsCollector.getRunMetrics(histRun.id)
      const nodeMetric = metrics?.nodeMetrics.find(nm => nm.nodeId === histNode.id)
      if (nodeMetric?.firstPassApproved) passCount++
    }
  }

  return totalCount > 0 ? passCount / totalCount : 0.5
}
```

### 4.4 outputQuality（启发式）

```typescript
private getOutputQuality(nodeId: string): number {
  const turns = this.workflowEngine.getNodeTurns(nodeId)
  const lastTurn = [...turns].reverse().find(t => t.status === 'completed')
  if (!lastTurn?.output) return 0.0

  let score = 1.0

  // 输出过短
  if (lastTurn.output.length < 100) score -= 0.3

  // 包含常见错误指标
  const errorPatterns = ['error', 'Error', 'FAIL', 'failed', 'exception', 'panic']
  const hasErrors = errorPatterns.some(p => lastTurn.output.includes(p))
  if (hasErrors) score -= 0.4

  // 包含常见告警
  const warnPatterns = ['warning', 'Warning', 'deprecated', 'TODO']
  const hasWarnings = warnPatterns.some(p => lastTurn.output.includes(p))
  if (hasWarnings) score -= 0.1

  return Math.max(0, Math.min(1, score))
}
```

### 4.5 executionStability

```typescript
private getExecutionStability(nodeId: string): number {
  const turns = this.workflowEngine.getNodeTurns(nodeId)
  if (turns.length === 0) return 0.0

  let score = 1.0

  // 多次 Turn = 不稳定（说明中间有重试或提问）
  if (turns.length > 1) score -= 0.2 * (turns.length - 1)

  // 最后一个 Turn 的执行时间
  const lastTurn = turns[turns.length - 1]
  const duration = (lastTurn.completedAt || Date.now()) - lastTurn.startedAt
  // 超过 5 分钟扣分
  if (duration > 5 * 60 * 1000) score -= 0.2
  // 超过 8 分钟严重扣分
  if (duration > 8 * 60 * 1000) score -= 0.3

  return Math.max(0, Math.min(1, score))
}
```

---

## 5. 审计与可观测

### 5.1 AutoFlow 评估日志

每次评估都通过 `RobustnessService.audit()` 记录：

```typescript
{
  action: 'autoflow_evaluation',
  level: 'info',
  runId, nodeId,
  details: {
    confidence: 82,
    threshold: 75,
    decision: 'auto_approve',
    signals: { contractSatisfaction: 1.0, exitConditions: 1.0, ... },
    reasoning: 'All contracts satisfied, exit conditions passed, historical pass rate 85%'
  }
}
```

### 5.2 前端展示

在节点详情中增加 AutoFlow 评估结果展示：
- 信心分（进度条）
- 各信号的贡献值
- 决策结果（自动通过 / 需人工）
- 如果是自动通过，显示「✅ AutoFlow 自动通过 (confidence: 82/75)」

WebSocket 事件扩展：
```typescript
// 新增 WsMessageType
| 'autoflow:evaluated'     // AutoFlow 完成评估
```

---

## 6. 实施分期

### Phase 1: 核心引擎 ✅ 已完成

- [x] 新建 `auto-flow-engine.ts` 服务（605 行）
- [x] 扩展 `RunConfig` / `AutoFlowConfig` 类型
- [x] 修改 `agent.ts` close handler 接入 AutoFlow 决策点
- [x] 实现 5 个信号的采集与加权计算
- [x] 接入 RobustnessService 审计日志
- [x] evaluationCache LRU 上限（500 条）防内存泄漏
- [x] 空 value 防护（exitConditions.output_contains）

### Phase 2: 前端数据支持 ✅ 已完成

- [x] WebSocket 事件 `autoflow:evaluated` 实时广播
- [x] `GET /api/runs/:runId/nodes/:nodeId/autoflow` — 节点评估详情
- [x] `GET /api/runs/:runId/autoflow/summary` — Run 级别汇总
- [x] `PATCH /api/runs/:runId/config` — 动态更新 AutoFlow 配置（深度合并）
- [x] WorkflowEngine 新增 `emit()` 公开方法供外部服务广播

### Phase 3: 自适应学习 ✅ 已完成

- [x] `recordFeedback(runId, nodeId, 'approve'|'reject')` — 反馈采集
- [x] 自适应阈值调整算法（误判 +5，过于保守 -1.5，正确 -0.5）
- [x] 冷启动策略：前 3 次强制 review（threshold = 100）
- [x] 阈值限制在 [50, 95] 范围防止极端漂移
- [x] approve/reject 路由自动调用 `recordFeedback`
- [x] `GET /api/runs/autoflow/adaptive-stats` — 学习统计查询
- [x] 审计日志记录每次自适应调整

### Phase 4: 集成验证 ✅ 已完成

- [x] TypeScript 编译零错误
- [x] 向后兼容性验证（disabled 时行为不变）
- [x] Express 路由顺序正确（无路径冲突）
- [x] DET 模式不受 AutoFlow 影响
- [x] DI 注入链完整（index.ts → AutoFlowEngine → emitter → WorkflowEngine）

---

## 7. 向后兼容保证

| 场景 | 行为 |
|------|------|
| `autoFlow` 未配置 | 所有 LLM 节点仍走 `waiting_user_review`，行为不变 |
| `autoFlow.enabled = false` | 同上 |
| 特定节点 override `enabled = false` | 该节点即使全局开启也走 review |
| 历史 Run 无 autoFlow 配置 | 使用默认值（disabled），不影响 |
| DET 模式节点 | 不受 AutoFlow 影响（DET 本身就自动通过） |

---

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 误判自动通过导致低质量产出 | 中 | 高 | 默认阈值 75 偏保守；审计日志可追溯；首次运行强制 review |
| 信心评估阻塞 close handler | 低 | 中 | 所有信号采集为同步/快速内存查询，不涉及 I/O |
| 历史数据不足导致 pass rate 不准 | 高（初期） | 低 | 无历史数据时给中性分 0.5，不主导决策 |
| 用户不信任自动审批 | 中 | 中 | 默认关闭；逐步开启；审计日志透明可查 |

---

## 9. 验收标准

- [x] AutoFlow 关闭时，系统行为与当前完全一致
- [x] AutoFlow 开启且信心 ≥ 阈值时，节点自动标记 `completed` 并推进 DAG
- [x] AutoFlow 开启且信心 < 阈值时，节点正常进入 `wait_user_review`
- [x] 每次评估都有审计日志记录
- [x] `RunConfig` 可通过 API 动态修改 AutoFlow 配置
- [x] DET 模式不受 AutoFlow 逻辑影响
- [x] 前端能展示节点的 AutoFlow 评估结果（API 已就绪）
- [x] 冷启动策略：新节点类型前 3 次强制 review
- [x] 自适应学习：用户反馈自动调整阈值
- [x] WebSocket 事件实时推送评估结果
