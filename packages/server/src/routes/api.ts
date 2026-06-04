/**
 * API Router — 薄协调器
 *
 * 职责：接收所有依赖注入，分发给各子路由，并将它们挂载到对应前缀。
 * 每个子路由文件只关心自身领域的 endpoint 实现，与其他域完全解耦。
 *
 * 路由挂载映射：
 *   /auth/*           → auth.ts        (GitHub OAuth)
 *   /projects/*       → projects.ts    (项目 + 模板 CRUD)
 *   /runs/*           → runs.ts        (Run + Node 生命周期)
 *   /agents/*         → agents.ts      (Agent 执行 + 动态实例)
 *   /files/*          → files.ts       (文件读写 + Skill)
 *   /git/*            → git.ts         (Git / Repo / Permission / Contract)
 *   /a2a/*            → a2a.ts         (A2A 通信协议)
 *   /robustness/*     → robustness.ts  (健壮性 / Checkpoint)
 *   /context-db/*     → context.ts     (四层 Context DB)
 *   /artifacts/*      → artifacts.ts   (Diff Review / Merge / Metrics / Feedback)
 *   /sync/*           → sync.ts        (GitHub 数据同步)
 */

import { Router } from 'express'
import type { AgentService } from '../services/agent.js'
import type { FileSystemService } from '../services/filesystem.js'
import type { SkillService } from '../services/skill.js'
import type { ProjectService } from '../services/project.js'
import type { WorkflowEngine } from '../services/workflow-engine.js'
import type { TemplateService } from '../services/template.js'
import type { AuthService } from '../services/auth.js'
import type { GitService } from '../services/git.js'
import type { RepoIsolationService } from '../services/repo-isolation.js'
import type { SkillMaterializationService } from '../services/skill-materialization.js'
import type { PermissionIsolationService } from '../services/permission-isolation.js'
import type { A2AProtocolService } from '../services/a2a-protocol.js'
import type { ContractValidatorService } from '../services/contract-validator.js'
import type { RobustnessService } from '../services/robustness.js'
import type { DynamicAgentFactory } from '../services/dynamic-agent-factory.js'
import type { ContextDBService } from '../services/context-db.js'
import type { ArtifactMergeService } from '../services/artifact-merge.js'
import type { MetricsCollector } from '../services/metrics-collector.js'
import type { FeedbackCollector } from '../services/feedback-collector.js'
import type { WeeklyDigest } from '../services/weekly-digest.js'
import type { SyncService } from '../services/sync.js'
import type { SkillExtractionService } from '../services/skill-extraction.js'
import type { AutoFlowEngine } from '../services/auto-flow-engine.js'
import type { L1RuleLifecycleService } from '../services/l1-rule-lifecycle.js'
import type { ValidationTurnService } from '../services/validation-turn.js'

import { createAuthRouter } from './auth.js'
import { createProjectsRouter } from './projects.js'
import { createRunsRouter } from './runs.js'
import { createAgentsRouter } from './agents.js'
import { createFilesRouter } from './files.js'
import { createGitRouter } from './git.js'
import { createA2ARouter } from './a2a.js'
import { createRobustnessRouter } from './robustness.js'
import { createContextRouter } from './context.js'
import { createArtifactsRouter } from './artifacts.js'
import { createSyncRouter } from './sync.js'
import { createL1RulesRouter } from './l1-rules.js'
import { createValidationRouter } from './validation.js'

export function createApiRouter(deps: {
  agentService: AgentService
  fileService: FileSystemService
  skillService: SkillService
  projectService: ProjectService
  workflowEngine: WorkflowEngine
  templateService: TemplateService
  authService: AuthService
  gitService: GitService
  repoIsolationService: RepoIsolationService
  skillMaterializationService: SkillMaterializationService
  permissionIsolationService: PermissionIsolationService
  a2aProtocolService: A2AProtocolService
  contractValidatorService: ContractValidatorService
  robustnessService: RobustnessService
  dynamicAgentFactory: DynamicAgentFactory
  contextDBService: ContextDBService
  artifactMergeService: ArtifactMergeService
  metricsCollector: MetricsCollector
  feedbackCollector: FeedbackCollector
  weeklyDigest: WeeklyDigest
  syncService: SyncService
  skillExtractionService: SkillExtractionService
  autoFlowEngine?: AutoFlowEngine
  l1RuleLifecycleService?: L1RuleLifecycleService
  validationTurnService?: ValidationTurnService
}): Router {
  const router = Router()

  // ── 挂载子路由 ──────────────────────────────────────────

  router.use('/auth', createAuthRouter({
    authService: deps.authService,
  }))

  const projectsRouter = createProjectsRouter({
    projectService: deps.projectService,
    agentService: deps.agentService,
    templateService: deps.templateService,
    workflowEngine: deps.workflowEngine,
    metricsCollector: deps.metricsCollector,
    contextDBService: deps.contextDBService,
  })
  router.use('/projects', projectsRouter)

  router.use('/runs', createRunsRouter({
    workflowEngine: deps.workflowEngine,
    templateService: deps.templateService,
    autoFlowEngine: deps.autoFlowEngine,
    repoIsolationService: deps.repoIsolationService,
  }))

  router.use('/agents', createAgentsRouter({
    agentService: deps.agentService,
    workflowEngine: deps.workflowEngine,
    dynamicAgentFactory: deps.dynamicAgentFactory,
  }))

  const filesRouter = createFilesRouter({
    fileService: deps.fileService,
    skillService: deps.skillService,
    skillMaterializationService: deps.skillMaterializationService,
    skillExtractionService: deps.skillExtractionService,
    projectService: deps.projectService,
    workflowEngine: deps.workflowEngine,
  })
  router.use('/files', filesRouter)

  router.use('/git', createGitRouter({
    gitService: deps.gitService,
    repoIsolationService: deps.repoIsolationService,
    permissionIsolationService: deps.permissionIsolationService,
    contractValidatorService: deps.contractValidatorService,
    workflowEngine: deps.workflowEngine,
    templateService: deps.templateService,
  }))

  router.use('/a2a', createA2ARouter({
    a2aProtocolService: deps.a2aProtocolService,
  }))

  router.use('/robustness', createRobustnessRouter({
    robustnessService: deps.robustnessService,
    workflowEngine: deps.workflowEngine,
  }))

  router.use('/context-db', createContextRouter({
    contextDBService: deps.contextDBService,
  }))

  const artifactsRouter = createArtifactsRouter({
    artifactMergeService: deps.artifactMergeService,
    metricsCollector: deps.metricsCollector,
    feedbackCollector: deps.feedbackCollector,
    weeklyDigest: deps.weeklyDigest,
    workflowEngine: deps.workflowEngine,
    projectService: deps.projectService,
  })
  router.use('/artifacts', artifactsRouter)

  router.use('/sync', createSyncRouter({
    syncService: deps.syncService,
  }))

  if (deps.l1RuleLifecycleService) {
    router.use('/l1-rules', createL1RulesRouter({
      l1RuleLifecycleService: deps.l1RuleLifecycleService,
    }))
  }

  if (deps.validationTurnService) {
    router.use('/validation', createValidationRouter({
      validationTurnService: deps.validationTurnService,
      workflowEngine: deps.workflowEngine,
    }))
  }

  // ═══════════════ DEV: Seed mock data for frontend verification ═══════════════

  router.post('/dev/seed/:runId', (req, res) => {
    const { runId } = req.params
    const run = deps.workflowEngine.getRun(runId)
    if (!run) {
      res.status(404).json({ success: false, error: 'Run not found' })
      return
    }

    // 1. Seed validation results
    if (deps.validationTurnService) {
      const vts = deps.validationTurnService as any
      const nodes = run.nodes
      const strategies: Array<'script' | 'contract' | 'llm' | 'composite'> = ['script', 'contract', 'llm', 'composite']

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const strategy = strategies[i % strategies.length]
        const score = 0.6 + Math.random() * 0.4  // 0.6 ~ 1.0
        const passed = score >= 0.7

        const result = {
          passed,
          strategy,
          score: Math.round(score * 100) / 100,
          details: [
            { name: 'OutputContract', passed: true, score: 0.95, output: '全部满足 (2 required + 1 optional)' },
            { name: strategy === 'script' ? 'TypeCheck' : 'LLM Review', passed, score: Math.round(score * 100) / 100, output: passed ? '检查通过' : '部分项未通过', duration: Math.round(Math.random() * 3000) },
            { name: 'OutputQuality', passed: score > 0.6, score: Math.round((score - 0.1) * 100) / 100, output: score > 0.6 ? '质量检查通过' : '输出过短' },
          ],
          duration: Math.round(200 + Math.random() * 2000),
          summary: passed
            ? `验证通过 (${Math.round(score * 100)}分)，3 项检查全部通过`
            : `验证未通过 (${Math.round(score * 100)}分)，1/3 项未通过: OutputQuality`,
        }

        // Inject into the validation cache
        if (vts.validationResults && vts.validationResults instanceof Map) {
          vts.validationResults.set(`${runId}:${node.id}`, result)
        }
      }
    }

    // 2. Seed feedback data — 使用公开 API，数据会同时写入 todayEntries + 文件系统
    if (deps.feedbackCollector) {
      const fc = deps.feedbackCollector
      const nodes = run.nodes

      // 模拟审批打回
      fc.recordReviewReject({
        runId,
        nodeId: nodes[1]?.id || 'node_1',
        nodeName: nodes[1]?.name || 'fix',
        reason: '代码缺少错误处理，关键路径未做 try-catch',
        retryCount: 2,
      })
      fc.recordReviewReject({
        runId,
        nodeId: nodes[1]?.id || 'node_1',
        nodeName: nodes[1]?.name || 'fix',
        reason: '函数缺少返回类型声明，TypeScript strict 模式不通过',
        retryCount: 1,
      })

      // 模拟执行失败
      fc.recordExecutionFailure({
        runId,
        nodeId: nodes[2]?.id || 'node_2',
        nodeName: nodes[2]?.name || 'verify',
        error: '循环内存在 N+1 查询导致超时 (>30s)',
        failureType: 'timeout',
      })
      fc.recordExecutionFailure({
        runId,
        nodeId: nodes[0]?.id || 'node_0',
        nodeName: nodes[0]?.name || 'analyze',
        error: '边界条件未处理导致空指针异常: Cannot read property of null',
        failureType: 'crash',
      })

      // 模拟验证失败
      fc.recordValidationFailure({
        runId,
        nodeId: nodes[1]?.id || 'node_1',
        nodeName: nodes[1]?.name || 'fix',
        summary: 'SQL 拼接存在注入风险，安全检查未通过',
        details: '第 42 行使用了字符串拼接 SQL，建议使用参数化查询',
      })
      fc.recordValidationFailure({
        runId,
        nodeId: nodes[2]?.id || 'node_2',
        nodeName: nodes[2]?.name || 'verify',
        summary: '连接池未释放，存在连接泄漏',
        details: '测试运行 5 分钟后连接数持续上升，最终 OOM',
      })

      // 模拟 Diff 丢弃
      fc.recordDiffDiscard({
        runId,
        nodeId: nodes[3]?.id || 'node_3',
        filesDiscarded: 8,
        reason: 'README 和 JSDoc 变更与主线冲突，回退处理',
      })

      // 模拟手动备注
      fc.recordManualNote({
        runId,
        nodeId: nodes[0]?.id || 'node_0',
        note: '此次分析遗漏了并发场景，下次应纳入多线程测试用例',
      })
    }

    res.json({
      success: true,
      data: {
        message: `Seeded mock data for run ${runId}`,
        validationNodes: run.nodes.length,
        feedbackEntries: 8,
        feedbackTypes: ['review_reject x2', 'execution_failure x2', 'validation_failure x2', 'diff_discard x1', 'manual_note x1'],
      },
    })
  })

  return router
}
