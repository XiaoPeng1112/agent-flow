import type { AgentConfig, Project, Run, SkillInfo, WorkflowTemplate } from '../types'

const DEMO_PROJECT_ID = 'demo-growth-site'
const DEMO_TEMPLATE_ID = 'demo-template-sdd-web'
const DEMO_RUN_ID = 'demo-run-landing-refresh'

export const DEMO_READONLY_MESSAGE = '当前为 Demo 模式，展示的是内置 mock 数据。真实执行请在本地启动后端与 AI CLI。'

export const isForcedDemoMode = import.meta.env.VITE_DEMO_MODE === 'true'

export const demoModeState = {
  enabled: isForcedDemoMode,
}

export function setRuntimeDemoMode(enabled: boolean): void {
  demoModeState.enabled = enabled
}

export function shouldUseDemoMode(): boolean {
  return demoModeState.enabled
}

const timestamps = {
  created: Date.parse('2026-06-22T09:00:00+08:00'),
  started: Date.parse('2026-06-22T09:03:00+08:00'),
  completed: Date.parse('2026-06-22T09:18:00+08:00'),
  recent: Date.parse('2026-06-28T14:30:00+08:00'),
}

export const demoAgents: AgentConfig[] = [
  {
    id: 'codex-planner',
    name: 'Codex Planner (GPT-5.5)',
    role: 'planner',
    type: 'codex',
    description: '负责需求分析、信息补全与工作流规划。',
    model: 'gpt-5.5',
    modelDescription: '旗舰规划模型',
    category: 'codex',
    available: true,
    cliPath: '/demo/bin/codex',
  },
  {
    id: 'codex-manager',
    name: 'Codex Manager (GPT-5.4)',
    role: 'manager',
    type: 'codex',
    description: '负责验收、调度、风险控制和交付把关。',
    model: 'gpt-5.4',
    modelDescription: '高推理审查模型',
    category: 'codex',
    available: true,
    cliPath: '/demo/bin/codex',
  },
  {
    id: 'codex-coder',
    name: 'Codex Coder (GPT-5.3-codex)',
    role: 'executor',
    type: 'codex',
    description: '负责实现页面、组件、测试和小范围重构。',
    model: 'gpt-5.3-codex',
    modelDescription: '代码专精模型',
    category: 'codex',
    available: true,
    cliPath: '/demo/bin/codex',
  },
  {
    id: 'claude-manager',
    name: 'Claude Manager (Opus-4-7)',
    role: 'manager',
    type: 'claude',
    description: '适合较长文本审阅、交付说明和质量验收。',
    model: 'claude-opus-4-7',
    modelDescription: '长文审阅能力强',
    category: 'claude',
    available: true,
    cliPath: '/demo/bin/claude',
  },
  {
    id: 'claude-universal',
    name: 'Claude Universal (Sonnet-4-6)',
    role: 'planner',
    type: 'claude',
    description: '通用补位 Agent，可参与任意节点。',
    model: 'claude-sonnet-4-6',
    modelDescription: '通用平衡模型',
    category: 'claude',
    available: true,
    cliPath: '/demo/bin/claude',
  },
]

export const demoSkills: SkillInfo[] = [
  {
    id: 'skill-brand-tone',
    name: 'Brand Tone Guide',
    path: '/demo/.codex/skills/brand-tone',
    description: '统一产品文案语气、CTA 风格和面向开发者的表达方式。',
    triggers: ['landing page', 'marketing copy', 'hero section'],
  },
  {
    id: 'skill-design-system',
    name: 'Design System Checklist',
    path: '/demo/.codex/skills/design-system',
    description: '约束颜色、间距、组件一致性和移动端检查项。',
    triggers: ['responsive UI', 'design review', 'component polish'],
  },
  {
    id: 'skill-release-handoff',
    name: 'Release Handoff',
    path: '/demo/.codex/skills/release-handoff',
    description: '输出交付说明、风险清单和验收建议，方便 PM / QA 接手。',
    triggers: ['handoff', 'release note', 'acceptance'],
  },
]

export const demoTemplate: WorkflowTemplate = {
  id: DEMO_TEMPLATE_ID,
  name: 'SDD Web Feature Flow',
  description: '一个面向中小型 Web 需求的标准示范流程，从需求澄清到上线交付。',
  nodes: [
    {
      id: 'specify',
      name: '需求澄清',
      type: 'specify',
      description: '收敛业务目标、目标用户和验收口径。',
      agentRole: 'planner',
      skillIds: ['skill-brand-tone'],
      prompt: '梳理业务目标、用户收益和必须保留的页面信息结构。',
    },
    {
      id: 'design',
      name: '方案设计',
      type: 'design',
      description: '规划页面结构、内容模块和交互节奏。',
      agentRole: 'planner',
      skillIds: ['skill-design-system'],
      prompt: '输出一个可以直接交给实现节点的页面方案和模块分工。',
    },
    {
      id: 'implement',
      name: '页面实现',
      type: 'implement',
      description: '完成页面重构、组件改造和样式细化。',
      agentRole: 'executor',
      skillIds: ['skill-design-system'],
      prompt: '实现新首页，优先保证信息层级、转化引导和移动端体验。',
    },
    {
      id: 'review',
      name: '质量验收',
      type: 'review',
      description: '检查文案、视觉一致性和代码风险。',
      agentRole: 'manager',
      skillIds: ['skill-release-handoff'],
      prompt: '从产品体验、实现质量和上线风险角度做一次 review。',
    },
    {
      id: 'deliver',
      name: '交付总结',
      type: 'deliver',
      description: '输出交付说明、变更摘要和后续建议。',
      agentRole: 'manager',
      skillIds: ['skill-release-handoff'],
      prompt: '整理最终交付内容和推荐的下一步动作。',
    },
  ],
  edges: [
    { source: 'specify', target: 'design' },
    { source: 'design', target: 'implement' },
    { source: 'implement', target: 'review' },
    { source: 'review', target: 'deliver' },
  ],
}

export const demoProject: Project = {
  id: DEMO_PROJECT_ID,
  name: '示范项目 · SaaS 增长官网',
  path: '/demo/saas-growth-site',
  description: '给第一次接触 AgentFlow 的用户看的完整样例，所有数据均为 mock。',
  isDemo: true,
  contextConfig: {
    repoUrl: 'https://github.com/example/saas-growth-site',
    product: '开发者工具官网，目标是提升试用转化率。',
    technical: 'React 19 + TypeScript + Tailwind CSS',
  },
  enabledAgentIds: demoAgents.map((agent) => agent.id),
  mergeMode: 'pr',
  defaultExecutionMode: 'llm',
  skills: demoSkills,
  runs: [],
  createdAt: timestamps.created,
  lastActiveAt: timestamps.recent,
}

export const demoRun: Run = {
  id: DEMO_RUN_ID,
  projectId: DEMO_PROJECT_ID,
  templateId: DEMO_TEMPLATE_ID,
  name: '官网首页改版示例',
  description: '围绕“让首次访问者 30 秒内理解产品价值”完成的一次完整示范 Run。',
  isDemo: true,
  status: 'completed',
  createdAt: timestamps.created,
  startedAt: timestamps.started,
  completedAt: timestamps.completed,
  edges: demoTemplate.edges,
  nodes: [
    {
      id: 'node-specify',
      runId: DEMO_RUN_ID,
      name: '需求澄清',
      type: 'specify',
      description: '明确目标用户、页面目标和信息优先级。',
      status: 'completed',
      agentRole: 'planner',
      skillIds: ['skill-brand-tone'],
      order: 1,
      userInput: '请把官网首页改得更清晰，让开发团队负责人更快理解价值和下一步动作。',
      prompt: demoTemplate.nodes[0].prompt,
      startedAt: timestamps.started,
      completedAt: timestamps.started + 2 * 60 * 1000,
      artifacts: [
        {
          id: 'artifact-spec',
          nodeId: 'node-specify',
          title: '需求摘要.md',
          category: 'document',
          format: 'markdown',
          createdAt: timestamps.started + 2 * 60 * 1000,
          content: [
            '# 需求摘要',
            '',
            '- 目标用户：工程负责人、技术产品经理、DevEx 团队',
            '- 核心目标：提升首页试用按钮点击率与产品价值理解速度',
            '- 关键要求：信息层级清晰、移动端首屏完整、CTA 明确',
          ].join('\n'),
        },
      ],
    },
    {
      id: 'node-design',
      runId: DEMO_RUN_ID,
      name: '方案设计',
      type: 'design',
      description: '确定模块结构、内容节奏和视觉方向。',
      status: 'completed',
      agentRole: 'planner',
      skillIds: ['skill-design-system'],
      order: 2,
      prompt: demoTemplate.nodes[1].prompt,
      startedAt: timestamps.started + 2 * 60 * 1000,
      completedAt: timestamps.started + 5 * 60 * 1000,
      artifacts: [
        {
          id: 'artifact-design',
          nodeId: 'node-design',
          title: 'homepage-structure.md',
          category: 'document',
          format: 'markdown',
          createdAt: timestamps.started + 5 * 60 * 1000,
          content: [
            '# 页面结构',
            '',
            '1. Hero：一句话价值主张 + 主 CTA + 次 CTA',
            '2. Problem / Solution：强调团队协作中的上下文丢失问题',
            '3. Workflow Preview：用 4 步解释 AgentFlow 的闭环',
            '4. Trust / Metrics：展示效率与质量收益',
            '5. Final CTA：引导本地部署与试用',
          ].join('\n'),
        },
      ],
    },
    {
      id: 'node-implement',
      runId: DEMO_RUN_ID,
      name: '页面实现',
      type: 'implement',
      description: '改造页面结构和组件文案，形成可交付版本。',
      status: 'completed',
      agentRole: 'executor',
      skillIds: ['skill-design-system'],
      order: 3,
      prompt: demoTemplate.nodes[2].prompt,
      startedAt: timestamps.started + 5 * 60 * 1000,
      completedAt: timestamps.started + 11 * 60 * 1000,
      artifacts: [
        {
          id: 'artifact-impl',
          nodeId: 'node-implement',
          title: 'packages/client/src/pages/HomePage.tsx',
          category: 'code',
          format: 'tsx',
          filePath: 'packages/client/src/pages/HomePage.tsx',
          createdAt: timestamps.started + 11 * 60 * 1000,
          content: [
            'export function HomePage() {',
            '  return (',
            '    <main>',
            '      <section>',
            '        <h1>让多 Agent 开发流程第一次真正可见</h1>',
            '      </section>',
            '    </main>',
            '  )',
            '}',
          ].join('\n'),
        },
      ],
    },
    {
      id: 'node-review',
      runId: DEMO_RUN_ID,
      name: '质量验收',
      type: 'review',
      description: '确认页面达到首访演示和试用引导目标。',
      status: 'completed',
      agentRole: 'manager',
      skillIds: ['skill-release-handoff'],
      order: 4,
      prompt: demoTemplate.nodes[3].prompt,
      startedAt: timestamps.started + 11 * 60 * 1000,
      completedAt: timestamps.started + 14 * 60 * 1000,
      artifacts: [
        {
          id: 'artifact-review',
          nodeId: 'node-review',
          title: 'review-notes.md',
          category: 'report',
          format: 'markdown',
          createdAt: timestamps.started + 14 * 60 * 1000,
          content: [
            '# Review Notes',
            '',
            '- Hero 区域价值主张已经明显聚焦',
            '- 移动端 CTA 保持在首屏内，符合转化目标',
            '- 建议后续补充真实产品截图和 CLI 安装指引',
          ].join('\n'),
        },
      ],
    },
    {
      id: 'node-deliver',
      runId: DEMO_RUN_ID,
      name: '交付总结',
      type: 'deliver',
      description: '输出变更摘要、验证结论和下一步建议。',
      status: 'completed',
      agentRole: 'manager',
      skillIds: ['skill-release-handoff'],
      order: 5,
      prompt: demoTemplate.nodes[4].prompt,
      startedAt: timestamps.started + 14 * 60 * 1000,
      completedAt: timestamps.completed,
      artifacts: [
        {
          id: 'artifact-deliver',
          nodeId: 'node-deliver',
          title: 'handoff-summary.md',
          category: 'report',
          format: 'markdown',
          createdAt: timestamps.completed,
          content: [
            '# 交付总结',
            '',
            '- 已完成首页内容重构和模块顺序调整',
            '- 关键目标：提升首次访问理解效率和试用 CTA 可见性',
            '- 下一步建议：增加“本地后端 + AI CLI”安装引导页',
          ].join('\n'),
        },
      ],
    },
  ],
}

const demoProjectStats = {
  totalRuns: 1,
  completedRuns: 1,
  failedRuns: 0,
  runningRuns: 0,
  successRate: 100,
  totalNodes: demoRun.nodes.length,
  completedNodes: demoRun.nodes.length,
  totalTokens: 24860,
  totalInputTokens: 9820,
  totalOutputTokens: 15040,
  avgDuration: demoRun.completedAt! - demoRun.startedAt!,
  lastRunAt: demoRun.completedAt || null,
}

const demoRunTokenStats = {
  data: {
    totalInput: 9820,
    totalOutput: 15040,
    totalTokens: 24860,
    byNode: [
      { nodeId: 'node-specify', nodeName: '需求澄清', total: 3120 },
      { nodeId: 'node-design', nodeName: '方案设计', total: 4280 },
      { nodeId: 'node-implement', nodeName: '页面实现', total: 10940 },
      { nodeId: 'node-review', nodeName: '质量验收', total: 3810 },
      { nodeId: 'node-deliver', nodeName: '交付总结', total: 2710 },
    ],
    estimatedCost: {
      usd: 0.68,
      breakdown: 'Mock estimate for demo mode',
    },
  },
}

const demoContextFiles: Record<string, Record<string, string>> = {
  'SYS::global': {
    'engineering-playbook.md': [
      '# Engineering Playbook',
      '',
      '- 所有输出默认优先高可读性和可验证性',
      '- 变更说明必须包含目的、范围和风险',
      '- 前端页面需兼顾桌面端和移动端体验',
    ].join('\n'),
    'output-contract.md': [
      '# Output Contract',
      '',
      '- 交付类节点必须给出最终摘要',
      '- 审查类节点至少指出一个风险和一个建议',
      '- 文档类产出优先使用 Markdown',
    ].join('\n'),
  },
  [`L0::${DEMO_PROJECT_ID}`]: {
    'product.md': [
      '# Product Context',
      '',
      '这是一个面向开发团队的多 Agent 工作流编排平台。',
      '演示重点是帮助第一次见到系统的人快速理解：项目、Run、节点、Agent、产出物。 ',
    ].join('\n'),
    'technical.md': [
      '# Technical Context',
      '',
      '- Frontend: React 19 + TypeScript + Ant Design',
      '- Backend: Express + WebSocket',
      '- Runtime: 本地后端调用本机 AI CLI',
    ].join('\n'),
    'demo-notes.md': [
      '# Demo Notes',
      '',
      '- 此项目为只读示范数据',
      '- 所有 tokens、时长、文件内容均为 mock',
      '- 目标是帮助用户理解系统形态，而不是模拟真实执行',
    ].join('\n'),
  },
  [`L1::${DEMO_TEMPLATE_ID}`]: {
    'workflow-agreement.md': [
      '# Workflow Agreement',
      '',
      '- Planner 输出必须可直接交给 Executor 实现',
      '- Review 节点需要给出上线前的风险提示',
      '- Deliver 节点要面向非开发角色也可读',
    ].join('\n'),
    'quality-bar.md': [
      '# Quality Bar',
      '',
      '- 页面首屏必须在 30 秒内让读者理解价值主张',
      '- CTA 不得埋在长文案之后',
      '- 移动端不允许出现信息层级断裂',
    ].join('\n'),
  },
}

function listContextFiles(level: string, scopeId: string) {
  const files = demoContextFiles[`${level}::${scopeId}`] || {}
  return Object.entries(files).map(([filename, content]) => ({
    filename,
    level,
    scopeId,
    size: content.length,
  }))
}

function getContextFile(level: string, scopeId: string, filename: string) {
  const files = demoContextFiles[`${level}::${scopeId}`] || {}
  return files[filename]
}

function buildContextPreview() {
  const sys = Object.values(demoContextFiles['SYS::global'] || {}).join('\n\n')
  const l0 = Object.values(demoContextFiles[`L0::${DEMO_PROJECT_ID}`] || {}).join('\n\n')
  const l1 = Object.values(demoContextFiles[`L1::${DEMO_TEMPLATE_ID}`] || {}).join('\n\n')
  const formatted = [
    '# SYS',
    sys,
    '',
    '# L0',
    l0,
    '',
    '# L1',
    l1,
  ].join('\n')

  return {
    layers: [
      { level: 'SYS', count: 2 },
      { level: 'L0', count: 3 },
      { level: 'L1', count: 2 },
    ],
    formatted,
    totalLayers: 3,
    totalChars: formatted.length,
  }
}

function readOnlyError(): never {
  throw new Error(DEMO_READONLY_MESSAGE)
}

function notFound(pathname: string): never {
  throw new Error(`Demo mode 暂未提供接口: ${pathname}`)
}

function match(pathname: string, pattern: RegExp) {
  return pathname.match(pattern)
}

export function getDemoApiResponse(path: string, options?: RequestInit): unknown {
  const method = (options?.method || 'GET').toUpperCase()
  const url = new URL(path, 'https://demo.local')
  const pathname = url.pathname

  if (method === 'GET' && pathname === '/projects') {
    return { projects: [demoProject] }
  }
  if (method === 'GET' && pathname === '/projects/templates') {
    return { templates: [demoTemplate] }
  }
  if (method === 'GET' && pathname === '/agents/status') {
    return { agents: demoAgents }
  }
  if (method === 'GET' && pathname === '/agents') {
    return { agents: demoAgents }
  }
  if (method === 'GET' && pathname === '/auth/me') {
    return { authenticated: false, user: null }
  }
  if (method === 'GET' && pathname === '/sync/status') {
    return {
      configured: false,
      repoFullName: null,
      autoSync: false,
      lastSyncAt: null,
      lastCommitSha: null,
      authenticated: false,
      dirty: false,
    }
  }
  if (method === 'GET' && pathname === '/runs') {
    const projectId = url.searchParams.get('projectId')
    return { runs: projectId && projectId !== DEMO_PROJECT_ID ? [] : [demoRun] }
  }
  if (method === 'GET' && pathname === `/runs/${DEMO_RUN_ID}`) {
    return { run: demoRun }
  }
  if (method === 'GET' && pathname === `/runs/${DEMO_RUN_ID}/token-stats`) {
    return demoRunTokenStats
  }

  const projectSkills = match(pathname, /^\/projects\/([^/]+)\/skills$/)
  if (method === 'GET' && projectSkills) {
    return { skills: projectSkills[1] === DEMO_PROJECT_ID ? demoSkills : [] }
  }

  const projectEnabledAgents = match(pathname, /^\/projects\/([^/]+)\/enabled-agents$/)
  if (method === 'GET' && projectEnabledAgents) {
    return {
      enabledAgentIds: demoProject.enabledAgentIds || [],
      allAgentIds: demoAgents.map((agent) => agent.id),
    }
  }

  const projectStats = match(pathname, /^\/projects\/([^/]+)\/stats$/)
  if (method === 'GET' && projectStats) {
    return demoProjectStats
  }

  const tokenTrend = match(pathname, /^\/projects\/([^/]+)\/token-trend$/)
  if (method === 'GET' && tokenTrend) {
    const days = Number(url.searchParams.get('days') || 14)
    return {
      days,
      trend: [
        { date: '2026-06-20', runs: 0, tokens: 0 },
        { date: '2026-06-21', runs: 0, tokens: 0 },
        { date: '2026-06-22', runs: 1, tokens: 24860 },
      ],
    }
  }

  const projectContextPreview = match(pathname, /^\/projects\/([^/]+)\/context-preview$/)
  if (method === 'POST' && projectContextPreview) {
    return buildContextPreview()
  }

  const projectExport = match(pathname, /^\/projects\/([^/]+)\/export$/)
  if (method === 'POST' && projectExport) {
    return {
      project: demoProject,
      templates: [demoTemplate],
      runs: [demoRun],
      context: demoContextFiles,
      exportedAt: Date.now(),
      demo: true,
    }
  }

  const detectRepo = match(pathname, /^\/artifacts\/detect-repo-type\/([^/]+)$/)
  if (method === 'GET' && detectRepo) {
    return {
      repoType: 'team',
      ownerType: 'Organization',
      collaboratorCount: 6,
      recentAuthors: ['alice', 'bob', 'carol'],
      hasBranchProtection: true,
      confidence: 0.91,
      suggestedMergeMode: 'pr',
      reason: '示范项目模拟为团队协作仓库，推荐通过 PR 进行合入。',
    }
  }

  const mergeMode = match(pathname, /^\/artifacts\/merge-mode\/([^/]+)$/)
  if (method === 'GET' && mergeMode) {
    return { mergeMode: demoProject.mergeMode }
  }

  const diffReviews = match(pathname, /^\/artifacts\/diff-review\/([^/]+)\/([^/]+)$/)
  if (method === 'GET' && diffReviews) {
    return { reviews: [] }
  }

  if (method === 'GET' && pathname === `/agents/instances/${DEMO_RUN_ID}`) {
    return { instances: [] }
  }

  const nodeTurns = match(pathname, /^\/agents\/turns\/([^/]+)$/)
  if (method === 'GET' && nodeTurns) {
    return { turns: [] }
  }

  const contextList = match(pathname, /^\/context-db\/([^/]+)\/([^/]+)$/)
  if (method === 'GET' && contextList) {
    const [, level, scopeId] = contextList
    return { files: listContextFiles(level, scopeId) }
  }

  const contextFile = match(pathname, /^\/context-db\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (method === 'GET' && contextFile) {
    const [, level, scopeId, filename] = contextFile
    const content = getContextFile(level, scopeId, decodeURIComponent(filename))
    if (!content) throw new Error(`Demo file not found: ${filename}`)
    return { content, level, scopeId, filename: decodeURIComponent(filename) }
  }

  if (method === 'POST' && pathname === '/context-db/assemble') {
    return buildContextPreview()
  }

  if (method === 'GET' && pathname === `/context-db/L2-by-run/${DEMO_RUN_ID}`) {
    return { files: [] }
  }

  const metrics = match(pathname, /^\/artifacts\/metrics\/([^/]+)$/)
  if (method === 'GET' && metrics) {
    return {
      metrics: {
        totalDuration: demoProjectStats.avgDuration,
        totalNodes: demoProjectStats.totalNodes,
        completedNodes: demoProjectStats.completedNodes,
        totalTurns: 5,
        totalTokens: demoProjectStats.totalTokens,
      },
    }
  }

  const tokenDistribution = match(pathname, /^\/artifacts\/metrics\/([^/]+)\/token-distribution$/)
  if (method === 'GET' && tokenDistribution) {
    return {
      distribution: demoRunTokenStats.data.byNode.map((item) => ({
        nodeName: item.nodeName,
        totalTokens: item.total,
      })),
    }
  }

  const efficiency = match(pathname, /^\/artifacts\/metrics\/([^/]+)\/efficiency$/)
  if (method === 'GET' && efficiency) {
    return {
      table: demoRun.nodes.map((node, index) => ({
        nodeName: node.name,
        efficiencyScore: 88 - index * 4,
        duration: 90 + index * 30,
        retryCount: 0,
        firstPassApproved: true,
        tokenUsage: demoRunTokenStats.data.byNode[index]?.total || 0,
      })),
    }
  }

  if (method === 'POST' && pathname === '/artifacts/feedback') {
    return { entries: [] }
  }
  if (method === 'GET' && pathname.startsWith('/artifacts/feedback/stats')) {
    return {
      stats: {
        total: 0,
        byType: {},
        bySeverity: {},
      },
    }
  }
  if (method === 'POST' && pathname === '/artifacts/feedback/digest') {
    return {
      digest: {
        period: { start: '2026-06-16', end: '2026-06-22' },
        runsSummary: {
          totalRuns: 1,
          completedRuns: 1,
          failedRuns: 0,
          averageDuration: demoProjectStats.avgDuration,
          totalTokens: demoProjectStats.totalTokens,
        },
        feedbackSummary: { total: 0, byType: {}, bySeverity: {} },
        topIssues: [],
        agentPerformance: [],
        anomalies: [],
        signalHealth: { signals: [], overallHealth: 'insufficient_data' },
        historicalSnapshots: [],
        generatedAt: timestamps.recent,
      },
    }
  }

  if (method === 'GET' && pathname === '/runs/autoflow/adaptive-stats') {
    return {
      stats: {
        totalEvaluations: 5,
        autoApproved: 4,
        requireReview: 1,
        averageConfidence: 0.82,
        confidenceHistory: [],
        signalWeights: {},
        bayesianPrior: { alpha: 4, beta: 1, mean: 0.8 },
      },
    }
  }

  const autoFlowSummary = match(pathname, /^\/runs\/([^/]+)\/autoflow\/summary$/)
  if (method === 'GET' && autoFlowSummary) {
    return {
      autoFlowConfig: { enabled: true, confidenceThreshold: 0.8 },
      totalEvaluated: 5,
      autoApproved: 4,
      requireReview: 1,
      evaluations: [],
    }
  }

  const l1RulesTemplate = match(pathname, /^\/l1-rules\/template\/([^/]+)$/)
  if (method === 'GET' && l1RulesTemplate) {
    return { rules: [] }
  }
  if (method === 'GET' && pathname === '/l1-rules/stats') {
    return {
      stats: {
        total: 0,
        byStatus: { draft: 0, active: 0, decaying: 0, deprecated: 0, archived: 0 },
        averageEffectiveness: 0,
        topEffective: [],
        decayingCount: 0,
      },
    }
  }

  const validationSummary = match(pathname, /^\/validation\/([^/]+)$/)
  if (method === 'GET' && validationSummary) {
    return {
      summary: {
        totalValidated: 5,
        passed: 5,
        failed: 0,
        averageScore: 92,
      },
      results: [],
    }
  }

  const mergeConflicts = match(pathname, /^\/runs\/([^/]+)\/merge-conflicts$/)
  if (method === 'GET' && mergeConflicts) {
    return {
      summary: {
        nodesWithConflicts: 0,
        totalConflictFiles: 0,
        worstSeverityScore: 0,
      },
      conflicts: [],
    }
  }

  if (method === 'POST' && pathname === '/artifacts/feedback/aggregate') {
    return {
      summary: {
        totalEntries: 0,
        clusterCount: 0,
        criticalCount: 0,
        highCount: 0,
        periodDays: 14,
      },
      clusters: [],
    }
  }

  const a2aMessages = match(pathname, /^\/a2a\/messages\/([^/]+)$/)
  if (method === 'GET' && a2aMessages) {
    return { messages: [] }
  }
  if (method === 'GET' && pathname.startsWith('/a2a/stats')) {
    return { total: 0, queued: 0, processing: 0, resolved: 0, failed: 0, expired: 0 }
  }

  const adversarialSessions = match(pathname, /^\/adversarial\/sessions\/([^/]+)\/([^/]+)$/)
  if (method === 'GET' && adversarialSessions) {
    return { sessions: [], total: 0 }
  }

  const checkpoints = match(pathname, /^\/robustness\/checkpoints\/([^/]+)$/)
  if (method === 'GET' && checkpoints) {
    return { checkpoints: [] }
  }
  if (method === 'GET' && pathname === '/robustness/health') {
    return { status: 'healthy', demo: true }
  }

  if (method !== 'GET') {
    if (pathname === '/sync/push' || pathname === '/sync/pull' || pathname.startsWith('/sync/') || pathname.startsWith('/auth/')) {
      readOnlyError()
    }
    if (
      pathname.startsWith('/projects/') ||
      pathname.startsWith('/runs/') ||
      pathname.startsWith('/agents/') ||
      pathname.startsWith('/context-db/') ||
      pathname.startsWith('/artifacts/') ||
      pathname.startsWith('/validation/') ||
      pathname.startsWith('/a2a/') ||
      pathname.startsWith('/adversarial/') ||
      pathname.startsWith('/robustness/')
    ) {
      readOnlyError()
    }
  }

  return notFound(pathname)
}
