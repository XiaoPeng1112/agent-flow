import { ReplayCursor } from './replay-cursor'
/**
 * AgentFlow API Client
 * 与后端 REST API 对接
 */

import { getDemoApiResponse, shouldUseDemoMode } from '../demo/mockData'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
const API_TOKEN = import.meta.env.VITE_AGENT_FLOW_API_TOKEN as string | undefined

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  if (shouldUseDemoMode()) {
    return getDemoApiResponse(path, options) as T
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(API_TOKEN ? { 'X-Agent-Flow-Token': API_TOKEN } : {}),
      ...options?.headers,
    },
  })
  const json = await res.json()
  if (!res.ok || json.success === false) {
    // 条件路由未注册时后端返回 404，给出更友好的错误信息
    if (res.status === 404) {
      throw new Error(json.error || '该功能模块未启用 (404)')
    }
    throw new Error(json.error || `Request failed: ${res.status}`)
  }
  return json.data ?? json
}

// ═══════════════ Project API ═══════════════

export const projectApi = {
  list: () => request<{ projects: any[] }>('/projects'),

  create: (data: { name: string; path: string; description?: string }) =>
    request<{ project: any }>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { name?: string; description?: string; contextConfig?: any; enabledAgentIds?: string[]; mergeMode?: 'local' | 'pr'; defaultExecutionMode?: 'llm' | 'det' | 'hyb' }) =>
    request<{ project: any }>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),

  getSkills: (id: string) =>
    request<{ skills: any[] }>(`/projects/${id}/skills`),

  /** 获取项目启用的 Agent 列表 */
  getEnabledAgents: (id: string) =>
    request<{ enabledAgentIds: string[]; allAgentIds: string[] }>(`/projects/${id}/enabled-agents`),

  /** 更新项目启用的 Agent 列表 */
  updateEnabledAgents: (id: string, enabledAgentIds: string[]) =>
    request<{ project: any }>(`/projects/${id}/enabled-agents`, {
      method: 'PUT',
      body: JSON.stringify({ enabledAgentIds }),
    }),

  /** 获取项目运行统计 */
  getStats: (id: string) =>
    request<{
      totalRuns: number
      completedRuns: number
      failedRuns: number
      runningRuns: number
      successRate: number
      totalNodes: number
      completedNodes: number
      totalTokens: number
      totalInputTokens: number
      totalOutputTokens: number
      avgDuration: number
      lastRunAt: number | null
    }>(`/projects/${id}/stats`),

  /** 获取项目 Token 使用趋势 */
  getTokenTrend: (id: string, days = 14) =>
    request<{ trend: Array<{ date: string; runs: number; tokens: number }>; days: number }>(`/projects/${id}/token-trend?days=${days}`),

  /** 导出项目数据快照 */
  exportData: (id: string, options?: { includeRuns?: boolean; includeContext?: boolean }) =>
    request<any>(`/projects/${id}/export`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }),

  /** 批量清理项目 Runs */
  cleanupRuns: (id: string, params: { olderThanDays?: number; status?: string; runIds?: string[] }) =>
    request<{ deleted: number; total: number }>(`/projects/${id}/cleanup-runs`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  /** 获取上下文装配预览 */
  getContextPreview: (id: string, params?: { templateId?: string; nodeId?: string }) =>
    request<{ layers: any[]; formatted: string; totalLayers: number; totalChars: number }>(`/projects/${id}/context-preview`, {
      method: 'POST',
      body: JSON.stringify(params || {}),
    }),
}

// ═══════════════ Template API ═══════════════

export const templateApi = {
  list: () => request<{ templates: any[] }>('/projects/templates'),

  get: (id: string) => request<{ template: any }>(`/projects/templates/${id}`),

  create: (data: any) =>
    request<{ template: any }>('/projects/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/projects/templates/${id}`, { method: 'DELETE' }),
}

// ═══════════════ Run API ═══════════════

export const runApi = {
  list: (projectId?: string) =>
    request<{ runs: any[] }>(`/runs${projectId ? `?projectId=${projectId}` : ''}`),

  get: (id: string) => request<{ run: any }>(`/runs/${id}`),

  create: (data: { projectId: string; templateId: string; name?: string }) =>
    request<{ run: any }>('/runs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  start: (id: string) =>
    request<{ run: any }>(`/runs/${id}/start`, { method: 'POST' }),

  pause: (id: string) =>
    request<{ run: any }>(`/runs/${id}/pause`, { method: 'POST' }),

  resume: (id: string) =>
    request<{ run: any }>(`/runs/${id}/resume`, { method: 'POST' }),

  delete: (id: string) =>
    request<void>(`/runs/${id}`, { method: 'DELETE' }),

  getTokenStats: (id: string) =>
    request<{ data: { totalInput: number; totalOutput: number; totalTokens: number; byNode: any[]; estimatedCost?: { usd: number; breakdown: string } } }>(`/runs/${id}/token-stats`),
}

// ═══════════════ Node API ═══════════════

export const nodeApi = {
  start: (runId: string, nodeId: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/start`, { method: 'POST' }),

  submit: (runId: string, nodeId: string, decision: string, error?: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ decision, error }),
    }),

  approve: (runId: string, nodeId: string, feedback?: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),

  reject: (runId: string, nodeId: string, feedback?: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),

  skip: (runId: string, nodeId: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/skip`, { method: 'POST' }),

  rollback: (runId: string, nodeId: string) =>
    request<{ run: any }>(`/runs/${runId}/nodes/${nodeId}/rollback`, { method: 'POST' }),

  forceReset: (runId: string, nodeId: string) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/force-reset`, { method: 'POST' }),

  updateSkills: (runId: string, nodeId: string, skillIds: string[]) =>
    request<{ node: any }>(`/runs/${runId}/nodes/${nodeId}/skills`, {
      method: 'PATCH',
      body: JSON.stringify({ skillIds }),
    }),

  getArtifacts: (runId: string, nodeId: string) =>
    request<{ artifacts: any[] }>(`/runs/${runId}/nodes/${nodeId}/artifacts`),

  addArtifact: (runId: string, nodeId: string, data: any) =>
    request<{ artifact: any }>(`/runs/${runId}/nodes/${nodeId}/artifacts`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// ═══════════════ Agent API ═══════════════

export const agentApi = {
  getModels: (refresh = false) => request<{ models: Array<{ id: string; name: string; discovered?: boolean }>; source: 'cli' | 'builtin'; fetchedAt?: number; warning?: string }>(`/agents/models/codex?refresh=${refresh}`),
  setModel: (id: string, model: string) => request<{ agent: import('../types').AgentConfig }>(`/agents/${encodeURIComponent(id)}/model`, { method: 'PUT', body: JSON.stringify({ model }) }),

  list: () => request<{ agents: any[] }>('/agents'),

  /** 获取 Agent 列表含 CLI 可用性状态 */
  getStatus: () => request<{ agents: any[] }>('/agents/status'),

  getByRole: (role: string) => request<{ agents: any[] }>(`/agents/role/${role}`),

  /** 获取当前活跃 Turn 列表 */
  getActiveTurns: () => request<{ activeTurnIds: string[] }>('/agents/active-turns'),

  executeTurn: (data: {
    agentId: string
    nodeId: string
    runId: string
    prompt: string
    cwd?: string
    contextArtifacts?: string[]
  }) =>
    request<{ turnId: string }>('/agents/execute-turn', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  resumeTurn: (data: { runId: string; nodeId: string; turnId: string; prompt: string }) =>
    request<{ turnId: string }>('/agents/resume-turn', { method: 'POST', body: JSON.stringify(data) }),

  getProviderEvents: (runId: string, nodeId: string, turnId: string, after = 0) =>
    request<{ events: Array<{ sequence: number; timestamp: number; event: { type: string; [key: string]: unknown } }>; nextCursor: number; hasMore: boolean }>(
      `/agents/events/${runId}/${nodeId}/${turnId}?after=${after}`),

  /** 执行 DET/HYB 模式 */
  executeDET: (data: {
    nodeId: string
    runId: string
    script: string
    cwd?: string
    executionMode?: 'det' | 'hyb'
    agentId?: string
    prompt?: string
  }) =>
    request<{ turnId: string }>('/agents/execute-det', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  cancelTurn: (turnId: string) =>
    request<{ cancelled: boolean }>('/agents/cancel-turn', {
      method: 'POST',
      body: JSON.stringify({ turnId }),
    }),

  answerQuestion: (data: {
    nodeId: string
    runId: string
    agentId: string
    originalQuestion: string
    answer: string
    cwd?: string
  }) =>
    request<{ turnId: string }>('/agents/answer', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getNodeTurns: (nodeId: string) =>
    request<{ turns: any[] }>(`/agents/turns/${nodeId}`),

  /** 动态 Agent: 执行（创建实例 + 构建 context + 启动 Turn）*/
  executeDynamic: (data: {
    nodeId: string
    runId: string
    userInput: string
    preferredAgentId?: string
    cwd?: string
  }) =>
    request<{ turnId: string; instanceId: string; instanceName: string }>('/agents/execute-dynamic', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 动态 Agent: 获取 Run 下所有实例 */
  getInstances: (runId: string) =>
    request<{ instances: any[] }>(`/agents/instances/${runId}`),

  /** 动态 Agent: 获取节点关联实例 */
  getNodeInstance: (runId: string, nodeId: string) =>
    request<{ instance: any }>(`/agents/instances/${runId}/${nodeId}`),
}

// ═══════════════ Diff Review API (产出物闭环) ═══════════════

export const diffReviewApi = {
  /** 生成 Diff Review */
  create: (runId: string, nodeId: string, turnId: string) =>
    request<{ review: any }>(`/artifacts/diff-review/${runId}/${nodeId}`, {
      method: 'POST',
      body: JSON.stringify({ turnId }),
    }),

  /** 获取节点的 Diff Reviews */
  getForNode: (runId: string, nodeId: string) =>
    request<{ reviews: any[] }>(`/artifacts/diff-review/${runId}/${nodeId}`),

  /** 获取指定文件的详细 Diff */
  getFileDiff: (runId: string, nodeId: string, turnId: string, filePath: string) =>
    request<{ fileDiff: any }>(`/artifacts/diff-review/${runId}/${nodeId}/${turnId}/file?path=${encodeURIComponent(filePath)}`),

  /** 合入工作分支 */
  merge: (runId: string, nodeId: string, turnId: string, strategy?: string) =>
    request<{ success: boolean; error?: string; mergeCommit?: string; filesAffected: number }>(`/artifacts/merge/${runId}/${nodeId}`, {
      method: 'POST',
      body: JSON.stringify({ turnId, strategy }),
    }),

  /** 丢弃工作分支 */
  discard: (runId: string, nodeId: string, turnId: string) =>
    request<{ success: boolean }>(`/artifacts/discard/${runId}/${nodeId}`, {
      method: 'POST',
      body: JSON.stringify({ turnId }),
    }),

  /** 创建 PR（PR 模式） */
  createPR: (runId: string, nodeId: string, params: { turnId: string; title?: string; body?: string; draft?: boolean }) =>
    request<{ success: boolean; error?: string; prUrl: string; prNumber: number; owner: string; repo: string }>(`/artifacts/create-pr/${runId}/${nodeId}`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  /** 查询 PR 状态 */
  getPRStatus: (owner: string, repo: string, prNumber: number) =>
    request<{ state: string; merged: boolean; mergeable: boolean; title: string; html_url: string }>(`/artifacts/pr-status/${owner}/${repo}/${prNumber}`),

  /** 获取项目 merge 模式 */
  getMergeMode: (projectId: string) =>
    request<{ mergeMode: 'local' | 'pr' }>(`/artifacts/merge-mode/${projectId}`),

  /** 检测仓库类型（团队 / 个人） */
  detectRepoType: (projectId: string) =>
    request<{
      repoType: 'team' | 'personal'
      ownerType: 'Organization' | 'User'
      collaboratorCount: number
      recentAuthors: string[]
      hasBranchProtection: boolean
      confidence: number
      suggestedMergeMode: 'local' | 'pr'
      reason: string
    }>(`/artifacts/detect-repo-type/${projectId}`),

  /** 检测并自动设置 mergeMode（团队项目强制 PR） */
  detectAndSetMergeMode: (projectId: string) =>
    request<{
      repoType: 'team' | 'personal'
      ownerType: 'Organization' | 'User'
      collaboratorCount: number
      recentAuthors: string[]
      hasBranchProtection: boolean
      confidence: number
      suggestedMergeMode: 'local' | 'pr'
      reason: string
      applied: boolean
      mergeMode: 'local' | 'pr'
      locked: boolean
    }>(`/artifacts/detect-and-set-merge-mode/${projectId}`, { method: 'POST' }),
}

// ═══════════════ Metrics API (可观测性) ═══════════════

export const metricsApi = {
  /** 获取 Run 的完整指标 */
  getRunMetrics: (runId: string) =>
    request<{ metrics: any }>(`/artifacts/metrics/${runId}`),

  /** 获取 Token 分布 */
  getTokenDistribution: (runId: string) =>
    request<{ distribution: any[] }>(`/artifacts/metrics/${runId}/token-distribution`),

  /** 获取效率表格 */
  getEfficiency: (runId: string) =>
    request<{ table: any[] }>(`/artifacts/metrics/${runId}/efficiency`),

  /** 获取趋势对比 */
  getTrend: (templateId: string) =>
    request<{ trend: any[] }>(`/artifacts/metrics/trend/${templateId}`),
}

// ═══════════════ Feedback API (反馈闭环) ═══════════════

export const feedbackApi = {
  /** 查询反馈记录 */
  query: (params?: { type?: string; runId?: string; severity?: string; limit?: number }) =>
    request<{ entries: FeedbackEntry[] }>('/artifacts/feedback', { method: 'POST', body: JSON.stringify(params || {}) }),

  /** 获取反馈统计 */
  getStats: (days = 7) =>
    request<{ stats: FeedbackStats }>(`/artifacts/feedback/stats?days=${days}`),

  /** 生成周报摘要 */
  generateDigest: (days = 7) =>
    request<{ digest: DigestData }>(`/artifacts/feedback/digest`, { method: 'POST', body: JSON.stringify({ days }) }),
}

// ═══════════════ AutoFlow API (自动放行引擎) ═══════════════

export const autoFlowApi = {
  /** 获取自适应学习统计 */
  getAdaptiveStats: () =>
    request<{ stats: AutoFlowAdaptiveStats }>('/runs/autoflow/adaptive-stats'),

  /** 获取节点的 AutoFlow 评估结果 */
  getNodeEvaluation: (runId: string, nodeId: string) =>
    request<{ evaluation: AutoFlowEvaluation | null }>(`/runs/${runId}/nodes/${nodeId}/autoflow`),

  /** 获取 Run 的 AutoFlow 汇总 */
  getRunSummary: (runId: string) =>
    request<AutoFlowRunSummary>(`/runs/${runId}/autoflow/summary`),

  /** 更新 Run 的 AutoFlow 配置 */
  updateConfig: (runId: string, config: AutoFlowConfig) =>
    request<void>(`/runs/${runId}/config`, {
      method: 'PATCH',
      body: JSON.stringify({ autoFlow: config }),
    }),
}

// ═══════════════ L1 Rule API (规则生命周期) ═══════════════

export const l1RuleApi = {
  /** 获取全局规则统计 */
  getStats: () =>
    request<{ stats: L1RuleStats }>('/l1-rules/stats'),

  /** 获取模板下所有规则 */
  getRulesForTemplate: (templateId: string) =>
    request<{ rules: L1Rule[] }>(`/l1-rules/template/${templateId}`),

  /** 获取节点的活跃规则 */
  getActiveRulesForNode: (templateId: string, nodeName: string) =>
    request<{ rules: L1Rule[] }>(`/l1-rules/node/${templateId}/${encodeURIComponent(nodeName)}`),

  /** 手动激活规则 */
  activateRule: (ruleId: string) =>
    request<void>(`/l1-rules/${ruleId}/activate`, { method: 'POST' }),

  /** 手动废弃规则 */
  deprecateRule: (ruleId: string, reason?: string) =>
    request<void>(`/l1-rules/${ruleId}/deprecate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
}

// ═══════════════ API Types (前后端共享类型) ═══════════════

// ─── Feedback Types ───

export interface FeedbackEntry {
  id: string
  type: 'review_reject' | 'diff_discard' | 'execution_failure' | 'manual_note'
  runId?: string
  nodeId?: string
  nodeName?: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  reason?: string
  note?: string
  timestamp: number
}

export interface FeedbackStats {
  total: number
  byType: Record<string, number>
  bySeverity: Record<string, number>
}

// ─── AutoFlow Types ───

export interface AutoFlowAdaptiveStats {
  totalEvaluations: number
  autoApproved: number
  requireReview: number
  averageConfidence: number
  confidenceHistory: Array<{ timestamp: number; confidence: number; decision: string }>
  signalWeights: Record<string, number>
  bayesianPrior: { alpha: number; beta: number; mean: number }
}

export interface AutoFlowEvaluation {
  decision: 'auto_approve' | 'require_review'
  confidence: number
  signals: ConfidenceSignals
  reasoning: string[]
  timestamp: number
}

export interface ConfidenceSignals {
  feedbackPositive: number
  contextRelevance: number
  historicalPassRate: number
  outputQuality: number
  executionStability: number
  mergeConflictFree: number
}

export interface AutoFlowRunSummary {
  autoFlowConfig: AutoFlowConfig | null
  totalEvaluated: number
  autoApproved: number
  requireReview: number
  evaluations: Array<{
    nodeId: string
    nodeName: string
    evaluation: AutoFlowEvaluation
  }>
}

export interface AutoFlowConfig {
  enabled?: boolean
  confidenceThreshold?: number
  nodeOverrides?: Record<string, { enabled?: boolean; confidenceThreshold?: number }>
}

// ─── L1 Rule Types ───

export type RuleLifecycleStatus = 'draft' | 'active' | 'decaying' | 'deprecated' | 'archived'
export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface L1Rule {
  id: string
  templateId: string
  nodeName: string
  status: RuleLifecycleStatus
  version: number
  items: RuleItem[]
  totalTriggerCount: number
  effectiveness: RuleEffectiveness
  decayInfo: RuleDecayInfo
  createdAt: number
  updatedAt: number
  changelog: RuleChangelogEntry[]
}

export interface RuleItem {
  description: string
  frequency: number
  severity: RuleSeverity
  example?: string
  firstSeen: number
  lastSeen: number
}

export interface RuleEffectiveness {
  baselineRejectRate: number
  currentRejectRate: number
  postRuleSamples: number
  postRuleRejects: number
  improvementRate: number
  lastMeasuredAt: number
}

export interface RuleDecayInfo {
  lastTriggeredAt: number
  daysSinceLastTrigger: number
  decayScore: number
}

export interface RuleChangelogEntry {
  version: number
  timestamp: number
  description: string
  changes: string[]
}

export interface L1RuleStats {
  total: number
  byStatus: Record<RuleLifecycleStatus, number>
  averageEffectiveness: number
  topEffective: Array<{ ruleId: string; nodeName: string; improvement: number }>
  decayingCount: number
}

// ─── WeeklyDigest Types ───

export type TrendDirection = 'improving' | 'stable' | 'degrading'

export interface MetricTrend {
  current: number
  previous: number
  changePercent: number
  direction: TrendDirection
}

export interface TrendAnalysis {
  runCount: MetricTrend
  completionRate: MetricTrend
  averageDuration: MetricTrend
  tokenUsage: MetricTrend
  firstPassRate: MetricTrend
  autoApproveRate?: MetricTrend
  accuracy?: MetricTrend
  overallDirection: TrendDirection
}

export interface Anomaly {
  metric: string
  value: number
  mean: number
  stddev: number
  zScore: number
  severity: 'warning' | 'critical'
  direction: 'spike' | 'drop'
  isNegative: boolean
  suggestion: string
}

export interface SignalHealthItem {
  name: string
  mean: number
  stdDev: number
  sampleCount: number
  health: 'healthy' | 'low_variance' | 'high_variance' | 'saturated'
}

export interface SignalHealthReport {
  signals: SignalHealthItem[]
  overallHealth: 'healthy' | 'acceptable' | 'needs_attention' | 'unknown' | 'insufficient_data'
}

export interface DigestData {
  period: { start: string; end: string }
  runsSummary: {
    totalRuns: number
    completedRuns: number
    failedRuns: number
    averageDuration: number
    totalTokens: number
  }
  feedbackSummary: FeedbackStats
  topIssues: Array<{
    pattern: string
    count: number
    severity: string
    suggestion: string
  }>
  agentPerformance: Array<{
    agentId: string
    runsParticipated: number
    firstPassRate: number
    averageTokens: number
  }>
  autoFlowMetrics?: {
    totalEvaluations: number
    autoApproved: number
    requireReview: number
    accuracy: number
    falsePositiveRate: number
    averageConfidence: number
    savedReviewTime: number
  }
  trendAnalysis?: TrendAnalysis
  anomalies: Anomaly[]
  signalHealth: SignalHealthReport
  historicalSnapshots: Array<{
    weekId: string
    period: { start: string; end: string }
    metrics: Record<string, number>
    generatedAt: number
  }>
  generatedAt: number
}

// ─── Validation Turn Types ───

export interface ValidationDetail {
  name: string
  passed: boolean
  score: number
  output?: string
  error?: string
  duration?: number
}

export interface ValidationResult {
  passed: boolean
  strategy: 'script' | 'llm' | 'contract' | 'composite' | 'skipped'
  score: number
  details: ValidationDetail[]
  duration: number
  summary: string
}

export interface ValidationSummary {
  totalValidated: number
  passed: number
  failed: number
  averageScore: number
}

export interface ValidationNodeResult {
  nodeId: string
  nodeName: string
  nodeType: string
  result: ValidationResult | null
}

// ─── Merge Conflict Types ───

export type ConflictSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical'

export interface ConflictDetail {
  type: 'content' | 'add/add' | 'modify/delete' | 'rename' | 'unknown'
  filePath: string
}

export interface MergeConflictResult {
  hasConflict: boolean
  conflictFiles: string[]
  conflicts: ConflictDetail[]
  targetBranch?: string
  severity: ConflictSeverity
  severityScore: number
}

export interface MergeConflictNodeEntry {
  nodeId: string
  nodeName: string
  hasConflict: boolean
  severity: string
  severityScore: number
  conflictFiles: string[]
  conflicts: ConflictDetail[]
}

export interface MergeConflictSummary {
  nodesWithConflicts: number
  totalConflictFiles: number
  worstSeverityScore: number
}

// ─── Feedback Aggregate Types ───

export type FeedbackUrgency = 'critical' | 'high' | 'normal' | 'low'

export interface FeedbackCluster {
  category: string
  categoryLabel: string
  severity: string
  urgency: FeedbackUrgency
  count: number
  topPatterns: Array<{ pattern: string; count: number }>
  latestTimestamp: number
  affectedNodes: string[]
}

export interface FeedbackAggregateSummary {
  totalEntries: number
  clusterCount: number
  criticalCount: number
  highCount: number
  periodDays: number
}

// ═══════════════ Validation API ═══════════════

export const validationApi = {
  /** 获取 Run 的验证汇总 */
  getRunSummary: (runId: string) =>
    request<{ summary: ValidationSummary; results: ValidationNodeResult[] }>(`/validation/${runId}`),

  /** 获取单个节点的验证结果 */
  getNodeResult: (runId: string, nodeId: string) =>
    request<{ result: ValidationResult | null }>(`/validation/${runId}/${nodeId}`),

  /** 手动触发验证 */
  triggerValidation: (runId: string, nodeId: string) =>
    request<{ result: ValidationResult }>(`/validation/${runId}/${nodeId}/trigger`, { method: 'POST' }),
}

// ═══════════════ Merge Conflict API ═══════════════

export const mergeConflictApi = {
  /** 获取 Run 的冲突汇总 */
  getRunConflicts: (runId: string) =>
    request<{ summary: MergeConflictSummary; conflicts: MergeConflictNodeEntry[] }>(`/runs/${runId}/merge-conflicts`),

  /** 获取单个节点的冲突详情 */
  getNodeConflict: (runId: string, nodeId: string) =>
    request<{ conflict: MergeConflictResult }>(`/runs/${runId}/nodes/${nodeId}/merge-conflicts`),
}

// ═══════════════ Feedback Aggregate API extension ═══════════════

export const feedbackAggregateApi = {
  /** 获取语义聚合视图 */
  getAggregate: (days = 14, runId?: string) =>
    request<{ summary: FeedbackAggregateSummary; clusters: FeedbackCluster[] }>('/artifacts/feedback/aggregate', {
      method: 'POST',
      body: JSON.stringify({ days, runId }),
    }),
}

// ═══════════════ Skill API ═══════════════

export const skillApi = {
  list: () => request<{ skills: any[] }>('/files/skills'),

  get: (name: string) => request<any>(`/files/skills/${name}`),

  reload: (paths?: string[]) =>
    request<{ skills: any[]; count: number }>('/files/skills/reload', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }),
}

// ═══════════════ Auth API (GitHub OAuth) ═══════════════

export const authApi = {
  /** 获取 GitHub OAuth 授权 URL */
  getAuthUrl: () => request<{ url: string; configured: boolean }>('/auth/github'),

  /** 获取当前登录用户 */
  me: () => request<{ user: any; authenticated: boolean }>('/auth/me'),

  /** 登出 */
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  /** 获取 GitHub repos 列表 */
  getRepos: () => request<{ repos: any[] }>('/auth/repos'),
}

// ═══════════════ Robustness API (Checkpoint & Health) ═══════════════

export const robustnessApi = {
  /** 获取 Run 的 Checkpoint 列表 */
  getCheckpoints: (runId: string) =>
    request<{ checkpoints: any[] }>(`/robustness/checkpoints/${runId}`),

  /** 创建 Checkpoint */
  createCheckpoint: (runId: string, description?: string) =>
    request<{ checkpoint: any }>(`/robustness/checkpoints/${runId}`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    }),

  /** 恢复到 Checkpoint */
  restoreCheckpoint: (runId: string, checkpointId: string) =>
    request<{ run: any }>(`/robustness/checkpoints/${runId}/restore/${checkpointId}`, {
      method: 'POST',
    }),

  /** 获取系统健康状态 */
  getHealth: () => request<any>('/robustness/health'),
}

// ═══════════════ Context DB API (四层上下文数据库) ═══════════════

export const contextDBApi = {
  /** 获取 Context DB 统计 */
  getStats: () => request<{ sys: number; l0: number; l1: number; l2: number; totalFiles: number }>('/context-db/stats'),

  /** 列出某层级的文件列表 */
  listFiles: (level: string, scopeId: string) =>
    request<{ files: Array<{ filename: string; level: string; scopeId: string; size: number }> }>(`/context-db/${level}/${scopeId}`),

  /** 按 runId 批量列出该 Run 所有节点的 L2 文件 */
  listL2ByRun: (runId: string) =>
    request<{ files: Array<{ filename: string; level: string; scopeId: string; size: number; nodeName: string }> }>(`/context-db/L2-by-run/${runId}`),

  /** 读取上下文文件 */
  getFile: (level: string, scopeId: string, filename: string) =>
    request<{ content: string; level: string; scopeId: string; filename: string }>(`/context-db/${level}/${scopeId}/${filename}`),

  /** 创建/更新上下文文件 */
  upsertFile: (level: string, scopeId: string, filename: string, content: string) =>
    request<{ path: string }>(`/context-db/${level}/${scopeId}/${filename}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  /** 删除上下文文件 */
  deleteFile: (level: string, scopeId: string, filename: string) =>
    request<{ deleted: boolean }>(`/context-db/${level}/${scopeId}/${filename}`, {
      method: 'DELETE',
    }),

  /** 装配上下文 */
  assemble: (params: { projectId?: string; templateId?: string; nodeId?: string }) =>
    request<{ layers: any[]; formatted: string; totalLayers: number }>('/context-db/assemble', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
}

// ═══════════════ A2A Protocol API (Agent-to-Agent 通信) ═══════════════

export const a2aApi = {
  /** 获取 Run 的所有 A2A 消息 */
  getMessages: (runId: string) =>
    request<{ messages: any[] }>(`/a2a/messages/${runId}`),

  /** 获取 A2A 统计 */
  getStats: (runId?: string) =>
    request<any>(`/a2a/stats${runId ? `?runId=${runId}` : ''}`),

  /** 获取 Agent 收件箱 */
  getInbox: (agentId: string, filters?: { status?: string; type?: string; runId?: string }) => {
    const params = new URLSearchParams()
    if (filters?.status) params.set('status', filters.status)
    if (filters?.type) params.set('type', filters.type)
    if (filters?.runId) params.set('runId', filters.runId)
    const qs = params.toString()
    return request<{ messages: any[] }>(`/a2a/inbox/${agentId}${qs ? `?${qs}` : ''}`)
  },

  /** 发送 A2A 消息 */
  send: (data: {
    fromAgentId: string
    toAgentId: string
    runId: string
    nodeId: string
    type: string
    payload: unknown
    priority?: string
    requiresAck?: boolean
  }) =>
    request<{ message: any }>('/a2a/send', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 委派任务 */
  delegate: (data: {
    fromAgentId: string
    toAgentId: string
    runId: string
    nodeId: string
    task: { title: string; intent: string; context?: string }
    priority?: string
  }) =>
    request<{ message: any }>('/a2a/delegate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 确认消息 */
  acknowledge: (messageId: string) =>
    request<{ success: boolean }>(`/a2a/ack/${messageId}`, { method: 'POST' }),

  /** 解决消息 */
  resolve: (messageId: string, result?: unknown) =>
    request<{ success: boolean }>(`/a2a/resolve/${messageId}`, {
      method: 'POST',
      body: JSON.stringify({ result }),
    }),

  /** 创建通信通道 */
  createChannel: (runId: string, participants: string[]) =>
    request<{ channel: any }>('/a2a/channels', {
      method: 'POST',
      body: JSON.stringify({ runId, participants }),
    }),
}

// ═══════════════ Adversarial / Sub-Turn API ═══════════════

export const adversarialApi = {
  /** 获取节点的所有对抗会话列表 */
  getSessions: (runId: string, nodeId: string) =>
    request<{ sessions: any[]; total: number }>(`/adversarial/sessions/${runId}/${nodeId}`),

  /** 获取单个会话详情（含所有 Sub-Turn） */
  getSession: (sessionId: string) =>
    request<{ session: any }>(`/adversarial/session/${sessionId}`),

  /** 获取节点的对抗结果摘要 */
  getResult: (runId: string, nodeId: string) =>
    request<{ result: any | null; hasResult: boolean }>(`/adversarial/result/${runId}/${nodeId}`),

  /** 获取节点当前活跃的对抗会话 */
  getActive: (runId: string, nodeId: string) =>
    request<{ session: any | null; isActive: boolean }>(`/adversarial/active/${runId}/${nodeId}`),
}

// ═══════════════ Sync API (GitHub 数据同步) ═══════════════

export const syncApi = {
  /** 获取同步状态 */
  getStatus: () => request<{
    configured: boolean
    repoFullName: string | null
    autoSync: boolean
    lastSyncAt: number | null
    lastCommitSha: string | null
    authenticated: boolean
    dirty: boolean
  }>('/sync/status'),

  /** 获取同步配置 */
  getConfig: () => request<{ config: any }>('/sync/config'),

  /** 配置同步仓库 */
  configure: (repoFullName: string, autoSync = true) =>
    request<{ config: any }>('/sync/config', {
      method: 'POST',
      body: JSON.stringify({ repoFullName, autoSync }),
    }),

  /** 更新自动同步开关 */
  setAutoSync: (autoSync: boolean) =>
    request<void>('/sync/config', {
      method: 'PATCH',
      body: JSON.stringify({ autoSync }),
    }),

  /** 断开同步 */
  disconnect: () =>
    request<void>('/sync/config', { method: 'DELETE' }),

  /** 推送到远端 */
  push: () =>
    request<{ success: boolean; filesUpdated: number; commitSha?: string }>('/sync/push', {
      method: 'POST',
    }),

  /** 从远端拉取 */
  pull: () =>
    request<{ success: boolean; filesRead: number; conflicts: string[] }>('/sync/pull', {
      method: 'POST',
    }),

  /** 创建同步专用私有仓库 */
  createRepo: (repoName: string) =>
    request<{ full_name: string; html_url: string }>('/sync/create-repo', {
      method: 'POST',
      body: JSON.stringify({ repoName }),
    }),
}

// ═══════════════ WebSocket（带生命周期管理的重连机制） ═══════════════

/**
 * 可管理的 WebSocket 连接
 * - 自动重连（3s 间隔）
 * - 外部可通过 dispose() 彻底关闭，不再重连
 * - 避免内存泄漏：dispose 后不会创建新连接
 */
export interface ManagedWebSocket {
  /** 彻底关闭连接并停止重连 */
  dispose: () => void
  /** 获取当前底层 WebSocket 实例（可能为 null） */
  getSocket: () => WebSocket | null
}

export function createWebSocket(onMessage: (msg: any) => void): ManagedWebSocket {
  if (shouldUseDemoMode()) {
    return {
      dispose() {},
      getSocket() {
        return null
      },
    }
  }

  const configuredWsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/ws'
  const wsUrl = new URL(configuredWsUrl)
  if (API_TOKEN) wsUrl.searchParams.set('token', API_TOKEN)
  const cursor = new ReplayCursor()
  let disposed = false
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // 指数退避重连参数
  const BASE_DELAY = 1000       // 初始延迟 1s
  const MAX_DELAY = 30000       // 最大延迟 30s
  const MAX_RETRIES = 10        // 最大连续重试次数
  let retryCount = 0

  function connect() {
    if (disposed) return
    const socket = new WebSocket(wsUrl)
    ws = socket

    socket.onopen = () => {
      if (disposed || ws !== socket) return
      socket.send(JSON.stringify(cursor.request()))
      // 连接成功，重置重试计数
      retryCount = 0
    }

    socket.onmessage = (event) => {
      if (disposed || ws !== socket) return
      try {
        const msg = JSON.parse(event.data)
        if (cursor.receive(msg, () => onMessage(msg))) socket.send(JSON.stringify(cursor.request()))
      } catch (err) {
        console.error('[WS] Parse error:', err)
      }
    }

    socket.onclose = () => {
      if (disposed || ws !== socket) return
      if (retryCount >= MAX_RETRIES) {
        console.error(`[WS] Max retries (${MAX_RETRIES}) reached, giving up.`)
        return
      }
      const delay = Math.min(BASE_DELAY * Math.pow(2, retryCount), MAX_DELAY)
      retryCount++
      console.log(`[WS] Disconnected, reconnecting in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES})...`)
      reconnectTimer = setTimeout(connect, delay)
    }

    socket.onerror = () => {
      // onerror 后一般会触发 onclose，这里不需要额外处理
    }
  }

  connect()

  return {
    dispose() {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) {
        ws.onclose = null // 防止 close 回调里再重连
        ws.close()
        ws = null
      }
    },
    getSocket() {
      return ws
    },
  }
}
