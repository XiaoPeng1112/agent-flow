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

  return router
}
