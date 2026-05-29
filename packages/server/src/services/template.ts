import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { WorkflowTemplate } from '../types/index.js'

/**
 * 工作流模板服务
 * 管理 SDD 流程模板（参考 MAF 的模板管理）
 */
export class TemplateService {
  private templates: Map<string, WorkflowTemplate> = new Map()
  private storagePath: string

  constructor() {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.storagePath = join(home, '.agent-flow', 'templates.json')
    this.registerDefaults()
  }

  private registerDefaults(): void {
    // 标准 SDD 流程（参考 MAF: specify → design → task → implement → review → deliver）
    this.addTemplate({
      id: 'sdd-standard',
      name: '标准 SDD 开发流程',
      description: '从需求分析到交付的完整软件开发闭环，参考 MAF 多 Agent 协作模式',
      nodes: [
        {
          id: 'specify',
          name: '需求分析',
          type: 'specify',
          description: '分析需求，明确功能边界、非功能约束和验收标准',
          agentRole: 'planner',
          skillIds: [],
          prompt: '请分析以下需求，产出需求分析文档，包括：功能点列表、非功能约束、验收标准、风险点。',
          outputContracts: [
            { id: 'oc_req_doc', title: '需求分析文档', category: 'document', format: 'markdown', required: true },
          ],
        },
        {
          id: 'design',
          name: '方案设计',
          type: 'design',
          description: '技术方案设计，包括架构选型、接口定义、数据模型',
          agentRole: 'planner',
          skillIds: [],
          prompt: '基于需求分析，设计技术方案。产出：架构图描述、技术选型、核心接口定义、数据模型。',
          outputContracts: [
            { id: 'oc_design_doc', title: '技术方案文档', category: 'document', format: 'markdown', required: true },
            { id: 'oc_interface', title: '接口定义', category: 'code', format: 'typescript', required: false },
          ],
        },
        {
          id: 'task_split',
          name: '任务拆分',
          type: 'task',
          description: '将方案拆分为可独立执行的开发子任务',
          agentRole: 'manager',
          skillIds: [],
          prompt: '基于技术方案，拆分为具体的开发子任务。每个任务需包含：任务目标、输入依赖、期望产出、预估复杂度。',
          outputContracts: [
            { id: 'oc_task_list', title: '任务清单', category: 'document', format: 'markdown', required: true },
          ],
        },
        {
          id: 'implement',
          name: '代码实现',
          type: 'implement',
          description: '根据任务清单逐个实现代码',
          agentRole: 'executor',
          skillIds: [],
          prompt: '根据任务清单和技术方案，实现代码。请确保代码质量、添加必要注释、遵循项目编码规范。',
          outputContracts: [
            { id: 'oc_code', title: '代码变更', category: 'code', format: 'typescript', required: true },
          ],
        },
        {
          id: 'review',
          name: '代码审查',
          type: 'review',
          description: '审查实现代码的质量、安全性和一致性',
          agentRole: 'manager',
          skillIds: [],
          prompt: '审查代码实现，关注：代码质量、潜在 bug、安全风险、性能问题、编码规范一致性。产出审查报告。',
          outputContracts: [
            { id: 'oc_review', title: '审查报告', category: 'report', format: 'markdown', required: true },
          ],
        },
        {
          id: 'test',
          name: '测试验证',
          type: 'test',
          description: '编写和执行测试用例，验证实现正确性',
          agentRole: 'executor',
          skillIds: [],
          prompt: '编写测试用例覆盖核心功能，执行测试并报告结果。',
          outputContracts: [
            { id: 'oc_test', title: '测试用例与报告', category: 'test', format: 'markdown', required: true },
          ],
        },
        {
          id: 'deliver',
          name: '交付汇总',
          type: 'deliver',
          description: '汇总所有产出物，生成交付报告',
          agentRole: 'manager',
          skillIds: [],
          prompt: '汇总本次开发的所有产出物，生成最终交付报告。包括：完成的功能列表、变更文件清单、测试结果、已知风险。',
          outputContracts: [
            { id: 'oc_final_report', title: '交付报告', category: 'report', format: 'markdown', required: true },
          ],
        },
      ],
      edges: [
        { source: 'specify', target: 'design' },
        { source: 'design', target: 'task_split' },
        { source: 'task_split', target: 'implement' },
        { source: 'implement', target: 'review' },
        { source: 'review', target: 'test' },
        { source: 'test', target: 'deliver' },
      ],
    })

    // 快速功能迭代
    this.addTemplate({
      id: 'quick-feature',
      name: '快速功能迭代',
      description: '适合小功能的快速开发，跳过详细设计直接实现',
      nodes: [
        {
          id: 'specify',
          name: '需求确认',
          type: 'specify',
          description: '快速确认需求要点',
          agentRole: 'planner',
          skillIds: [],
          prompt: '简要分析需求，确认核心功能点和实现路径。',
        },
        {
          id: 'implement',
          name: '代码实现',
          type: 'implement',
          description: '直接编码实现',
          agentRole: 'executor',
          skillIds: [],
          prompt: '根据需求直接实现代码。',
        },
        {
          id: 'test',
          name: '测试修复',
          type: 'test',
          description: '测试并修复问题',
          agentRole: 'executor',
          skillIds: [],
          prompt: '测试实现结果，修复发现的问题。',
        },
      ],
      edges: [
        { source: 'specify', target: 'implement' },
        { source: 'implement', target: 'test' },
      ],
    })

    // Bug 修复流程
    this.addTemplate({
      id: 'bug-fix',
      name: 'Bug 修复流程',
      description: '定位问题根因并修复',
      nodes: [
        {
          id: 'analyze',
          name: '问题分析',
          type: 'specify',
          description: '复现并分析问题根因',
          agentRole: 'planner',
          skillIds: [],
          prompt: '分析以下 bug，定位根因，提出修复方案。',
        },
        {
          id: 'fix',
          name: '修复实现',
          type: 'implement',
          description: '编写修复代码',
          agentRole: 'executor',
          skillIds: [],
          prompt: '根据分析结果修复问题。',
        },
        {
          id: 'verify',
          name: '回归验证',
          type: 'test',
          description: '验证修复且无回归',
          agentRole: 'executor',
          skillIds: [],
          prompt: '验证修复效果，确保无回归问题。',
        },
      ],
      edges: [
        { source: 'analyze', target: 'fix' },
        { source: 'fix', target: 'verify' },
      ],
    })

    // 并行开发流程（展示 DAG 非线性能力）
    this.addTemplate({
      id: 'parallel-dev',
      name: '前后端并行开发',
      description: '前端和后端可并行开发，最后集成测试',
      nodes: [
        {
          id: 'design',
          name: '接口设计',
          type: 'design',
          description: '设计前后端交互接口',
          agentRole: 'planner',
          skillIds: [],
          prompt: '设计 API 接口，确定请求/响应格式。',
        },
        {
          id: 'frontend',
          name: '前端实现',
          type: 'implement',
          description: '实现前端页面和交互',
          agentRole: 'executor',
          skillIds: [],
          prompt: '实现前端页面，使用 mock 数据联调。',
        },
        {
          id: 'backend',
          name: '后端实现',
          type: 'implement',
          description: '实现后端 API',
          agentRole: 'executor',
          skillIds: [],
          prompt: '实现后端 API 接口。',
        },
        {
          id: 'integrate',
          name: '集成测试',
          type: 'test',
          description: '前后端集成测试',
          agentRole: 'executor',
          skillIds: [],
          prompt: '前后端联调测试，验证接口对接正确。',
        },
      ],
      edges: [
        { source: 'design', target: 'frontend' },
        { source: 'design', target: 'backend' },
        { source: 'frontend', target: 'integrate' },
        { source: 'backend', target: 'integrate' },
      ],
    })
  }

  // ═══════════════ CRUD ═══════════════

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storagePath, 'utf-8')
      const custom = JSON.parse(raw) as WorkflowTemplate[]
      for (const tpl of custom) {
        this.templates.set(tpl.id, tpl)
      }
    } catch {
      // 无自定义模板
    }
  }

  private async persist(): Promise<void> {
    const dir = this.storagePath.replace(/\/[^/]+$/, '')
    await mkdir(dir, { recursive: true })
    // 只持久化非默认的自定义模板
    const custom = this.getTemplates().filter(
      (t) => !['sdd-standard', 'quick-feature', 'bug-fix', 'parallel-dev'].includes(t.id)
    )
    await writeFile(this.storagePath, JSON.stringify(custom, null, 2), 'utf-8')
  }

  addTemplate(template: WorkflowTemplate): void {
    this.templates.set(template.id, template)
  }

  getTemplates(): WorkflowTemplate[] {
    return Array.from(this.templates.values())
  }

  getTemplate(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id)
  }

  async createTemplate(data: Omit<WorkflowTemplate, 'id'>): Promise<WorkflowTemplate> {
    const template: WorkflowTemplate = {
      ...data,
      id: `tpl_${Date.now()}`,
    }
    this.templates.set(template.id, template)
    await this.persist()
    return template
  }

  async deleteTemplate(id: string): Promise<boolean> {
    // 不允许删除默认模板
    if (['sdd-standard', 'quick-feature', 'bug-fix', 'parallel-dev'].includes(id)) {
      return false
    }
    const deleted = this.templates.delete(id)
    if (deleted) await this.persist()
    return deleted
  }
}
