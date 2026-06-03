import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { WorkflowTemplate } from '../types/index.js'

/**
 * 工作流模板服务
 * 
 * 设计原则：
 * - 模板定义"流程骨架"（节点、边、角色声明、输入输出契约）
 * - 节点的 roleStatement 只描述"你是谁、你在流程中的位置"
 * - 具体的协作规则由 L1 上下文管理（不硬编码在模板里）
 * - 具体的项目信息由 L0 上下文管理
 * - 具体的任务细节由 L2 上下文 + userInput 管理
 * - 全局规范由 SYS 上下文管理
 * 
 * 模板 prompt 职责边界：
 * - ✅ 声明节点的角色身份和职能边界
 * - ✅ 声明输入依赖（从哪些前置节点获取什么产出物）
 * - ✅ 声明输出契约（必须产出什么格式的交付物）
 * - ❌ 不包含编码规范（SYS 层）
 * - ❌ 不包含项目技术栈（L0 层）
 * - ❌ 不包含节点间协作细节（L1 层）
 * - ❌ 不包含本次具体任务描述（L2 层 + userInput）
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
    // ═══════════════ 标准 SDD 开发流程 ═══════════════
    this.addTemplate({
      id: 'sdd-standard',
      name: '标准 SDD 开发流程',
      description: '从需求分析到交付的完整软件开发闭环，适用于中等规模功能开发（参考 MAF 多 Agent 协作模式）',
      nodes: [
        {
          id: 'specify',
          name: '需求分析',
          type: 'specify',
          description: '分析需求，明确功能边界、非功能约束和验收标准',
          agentRole: 'planner',
          skillIds: [],
          roleStatement: '你是需求分析师。你是本流程的起点，负责将模糊的用户需求转化为结构化的需求文档。你的产出物是后续所有节点工作的基础依据。',
          prompt: '你是需求分析师。你是本流程的起点，负责将模糊的用户需求转化为结构化的需求文档。你的产出物是后续所有节点工作的基础依据。\n\n你必须产出以下交付物：\n1. 「需求分析文档」— 使用 ## 需求分析文档 标题，包含功能描述、非功能约束、用户场景\n2. 「验收标准」— 使用 ## 验收标准 标题，包含可量化的验收条件列表',
          inputs: [],
          outputContracts: [
            { id: 'oc_req_doc', title: '需求分析文档', category: 'document', format: 'markdown', required: true },
            { id: 'oc_acceptance_criteria', title: '验收标准', category: 'document', format: 'markdown', required: true },
          ],
          exitConditions: [
            { type: 'output_contains', value: '验收标准', description: '必须包含明确的验收标准' },
          ],
        },
        {
          id: 'design',
          name: '方案设计',
          type: 'design',
          description: '技术方案设计，包括架构选型、接口定义、数据模型',
          agentRole: 'planner',
          skillIds: [],
          roleStatement: '你是技术架构师。基于需求分析文档，设计技术实现方案。你需要产出可执行的接口定义和数据模型，供实现节点直接使用。',
          prompt: '你是技术架构师。基于需求分析文档，设计技术实现方案。你需要产出可执行的接口定义和数据模型，供实现节点直接使用。\n\n你必须产出以下交付物：\n1. 「技术方案文档」— 使用 ## 技术方案文档 标题，包含架构选型、设计思路\n2. 「接口定义」— 使用 ```typescript:src/types/interfaces.ts 代码块，包含完整的 TypeScript 类型定义\n3. 「数据模型」（可选）— 使用 ```typescript:src/models/schema.ts 代码块',
          inputs: ['specify.oc_req_doc', 'specify.oc_acceptance_criteria'],
          outputContracts: [
            { id: 'oc_design_doc', title: '技术方案文档', category: 'document', format: 'markdown', required: true },
            { id: 'oc_interface_def', title: '接口定义', category: 'code', format: 'typescript', required: true },
            { id: 'oc_data_model', title: '数据模型', category: 'code', format: 'typescript', required: false },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'specify.oc_req_doc', description: '需求文档必须已产出' },
          ],
        },
        {
          id: 'task_split',
          name: '任务拆分',
          type: 'task',
          description: '将方案拆分为可独立执行的开发子任务',
          agentRole: 'manager',
          skillIds: [],
          roleStatement: '你是项目经理。将技术方案分解为可独立执行、可并行的开发子任务。每个子任务必须关联到具体的接口定义或功能点，确保实现节点能明确知道自己要做什么。',
          prompt: '你是项目经理。将技术方案分解为可独立执行、可并行的开发子任务。每个子任务必须关联到具体的接口定义或功能点，确保实现节点能明确知道自己要做什么。\n\n你必须产出以下交付物：\n1. 「任务清单」— 使用 ## 任务清单 标题，每个子任务包含目标、输入、产出和验收条件',
          inputs: ['design.oc_design_doc', 'design.oc_interface_def', 'specify.oc_acceptance_criteria'],
          outputContracts: [
            { id: 'oc_task_list', title: '任务清单', category: 'document', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'design.oc_interface_def', description: '接口定义必须已产出' },
          ],
          exitConditions: [
            { type: 'output_contains', value: '子任务', description: '必须拆分为至少 2 个子任务' },
          ],
        },
        {
          id: 'implement',
          name: '代码实现',
          type: 'implement',
          description: '根据任务清单逐个实现代码',
          agentRole: 'executor',
          skillIds: [],
          roleStatement: '你是开发工程师。根据任务清单中的子任务逐个实现代码。你必须严格遵循接口定义中的类型签名，不得自行新增或修改公开接口。',
          prompt: '你是开发工程师。根据任务清单中的子任务逐个实现代码。你必须严格遵循接口定义中的类型签名，不得自行新增或修改公开接口。\n\n你必须产出以下交付物：\n1. 「代码变更」— 使用 ```typescript:src/路径/文件名.ts 代码块标记每个实现文件\n2. 「变更说明」— 使用 ## 变更说明 标题，描述你改了什么、为什么这样改',
          inputs: ['task_split.oc_task_list', 'design.oc_interface_def', 'design.oc_data_model'],
          outputContracts: [
            { id: 'oc_code', title: '代码变更', category: 'code', format: 'typescript', required: true },
            { id: 'oc_change_log', title: '变更说明', category: 'document', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'task_split.oc_task_list', description: '任务清单必须已产出' },
          ],
          exitConditions: [
            { type: 'lint_pass', value: '', description: '代码必须通过 lint 检查' },
          ],
        },
        {
          id: 'review',
          name: '代码审查',
          type: 'review',
          description: '审查实现代码的质量、安全性和一致性',
          agentRole: 'manager',
          skillIds: [],
          roleStatement: '你是代码审查员。对比接口定义和实际实现，验证代码是否符合技术方案、是否存在安全风险或性能问题。你不关注代码风格（那由自动化工具检查），你关注的是逻辑正确性和架构一致性。',
          prompt: '你是代码审查员。对比接口定义和实际实现，验证代码是否符合技术方案、是否存在安全风险或性能问题。你不关注代码风格（那由自动化工具检查），你关注的是逻辑正确性和架构一致性。\n\n你必须产出以下交付物：\n1. 「审查报告」— 使用 ## 审查报告 标题，列出发现的问题及改进建议\n2. 「审查结论」— 使用 ## 审查结论 标题，给出通过/不通过的结论和理由',
          inputs: ['implement.oc_code', 'implement.oc_change_log', 'design.oc_interface_def', 'specify.oc_acceptance_criteria'],
          outputContracts: [
            { id: 'oc_review_report', title: '审查报告', category: 'report', format: 'markdown', required: true },
            { id: 'oc_review_verdict', title: '审查结论', category: 'document', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'implement.oc_code', description: '代码变更必须已产出' },
          ],
        },
        {
          id: 'test',
          name: '测试验证',
          type: 'test',
          description: '编写和执行测试用例，验证实现正确性',
          agentRole: 'executor',
          skillIds: [],
          roleStatement: '你是测试工程师。基于验收标准编写测试用例并执行，验证代码实现是否满足需求。你同时验证正常路径和异常路径。',
          prompt: '你是测试工程师。基于验收标准编写测试用例并执行，验证代码实现是否满足需求。你同时验证正常路径和异常路径。\n\n你必须产出以下交付物：\n1. 「测试用例」— 使用 ## 测试用例 标题，列出用例名称、输入、期望结果\n2. 「测试报告」— 使用 ## 测试报告 标题，包含通过率、失败用例分析',
          inputs: ['implement.oc_code', 'specify.oc_acceptance_criteria', 'review.oc_review_verdict'],
          outputContracts: [
            { id: 'oc_test_cases', title: '测试用例', category: 'test', format: 'markdown', required: true },
            { id: 'oc_test_report', title: '测试报告', category: 'report', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'review.oc_review_verdict', description: '审查结论必须已产出（审查通过才能进入测试）' },
          ],
          exitConditions: [
            { type: 'test_pass', value: '', description: '核心功能测试必须全部通过' },
          ],
        },
        {
          id: 'deliver',
          name: '交付汇总',
          type: 'deliver',
          description: '汇总所有产出物，生成交付报告',
          agentRole: 'manager',
          skillIds: [],
          roleStatement: '你是交付经理。汇总本次开发的全部产出物，检查验收标准是否全部满足，生成可交付的最终报告。',
          prompt: '你是交付经理。汇总本次开发的全部产出物，检查验收标准是否全部满足，生成可交付的最终报告。\n\n你必须产出以下交付物：\n1. 「交付报告」— 使用 ## 交付报告 标题，包含项目概述、各阶段产出物汇总、验收标准对照表',
          inputs: ['specify.*', 'design.*', 'implement.*', 'review.*', 'test.*'],
          outputContracts: [
            { id: 'oc_delivery_report', title: '交付报告', category: 'report', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'test.oc_test_report', description: '测试报告必须已产出' },
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

    // ═══════════════ 快速功能迭代 ═══════════════
    this.addTemplate({
      id: 'quick-feature',
      name: '快速功能迭代',
      description: '适合小功能的快速开发，跳过详细设计和任务拆分，直接实现并验证',
      nodes: [
        {
          id: 'specify',
          name: '需求确认',
          type: 'specify',
          description: '快速确认需求要点，明确范围和边界',
          agentRole: 'planner',
          skillIds: [],
          roleStatement: '你是需求分析师。快速梳理用户需求的核心要点，产出精简的需求摘要和实现路径建议。不需要完整的需求文档，但必须明确做什么、不做什么。',
          prompt: '你是需求分析师。快速梳理用户需求的核心要点，产出精简的需求摘要和实现路径建议。不需要完整的需求文档，但必须明确做什么、不做什么。\n\n你必须产出以下交付物：\n1. 「需求确认摘要」— 使用 ## 需求确认摘要 标题，包含核心需求要点、范围边界、实现路径建议',
          inputs: [],
          outputContracts: [
            { id: 'oc_qf_req', title: '需求确认摘要', category: 'document', format: 'markdown', required: true },
          ],
        },
        {
          id: 'implement',
          name: '代码实现',
          type: 'implement',
          description: '直接编码实现功能',
          agentRole: 'executor',
          skillIds: [],
          roleStatement: '你是全栈开发工程师。根据需求摘要直接实现代码。由于本流程跳过了详细设计，你需要在实现过程中自行决定技术方案，但必须保持代码简洁可维护。',
          prompt: '你是全栈开发工程师。根据需求摘要直接实现代码。由于本流程跳过了详细设计，你需要在实现过程中自行决定技术方案，但必须保持代码简洁可维护。\n\n你必须产出以下交付物：\n1. 「代码变更」— 使用 ```typescript:src/路径/文件名.ts 代码块标记每个实现文件\n2. 「变更说明」— 使用 ## 变更说明 标题，描述实现思路和技术选型理由',
          inputs: ['specify.oc_qf_req'],
          outputContracts: [
            { id: 'oc_qf_code', title: '代码变更', category: 'code', format: 'typescript', required: true },
            { id: 'oc_qf_change_log', title: '变更说明', category: 'document', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'specify.oc_qf_req', description: '需求确认必须完成' },
          ],
        },
        {
          id: 'test',
          name: '测试修复',
          type: 'test',
          description: '测试实现结果并修复发现的问题',
          agentRole: 'executor',
          skillIds: [],
          roleStatement: '你是测试工程师兼修复者。验证实现是否正确，发现问题直接修复。本流程无独立审查环节，你同时承担审查和测试职责。',
          prompt: '你是测试工程师兼修复者。验证实现是否正确，发现问题直接修复。本流程无独立审查环节，你同时承担审查和测试职责。\n\n你必须产出以下交付物：\n1. 「测试结果」— 使用 ## 测试结果 标题，包含测试用例、执行结果、发现的问题及修复情况',
          inputs: ['implement.oc_qf_code', 'specify.oc_qf_req'],
          outputContracts: [
            { id: 'oc_qf_test', title: '测试结果', category: 'test', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'implement.oc_qf_code', description: '代码实现必须完成' },
          ],
        },
        {
          id: 'deliver',
          name: '交付汇总',
          type: 'deliver',
          description: '汇总功能实现和测试结果',
          agentRole: 'manager',
          skillIds: [],
          roleStatement: '你是交付经理。汇总本次快速迭代的全部产出物并生成简要交付报告。',
          prompt: '你是交付经理。汇总本次快速迭代的全部产出物并生成简要交付报告。\n\n你必须产出以下交付物：\n1. 「交付报告」— 使用 ## 交付报告 标题，包含功能概述、实现成果、测试结果汇总',
          inputs: ['specify.*', 'implement.*', 'test.*'],
          outputContracts: [
            { id: 'oc_qf_report', title: '交付报告', category: 'report', format: 'markdown', required: true },
          ],
        },
      ],
      edges: [
        { source: 'specify', target: 'implement' },
        { source: 'implement', target: 'test' },
        { source: 'test', target: 'deliver' },
      ],
    })

    // ═══════════════ Bug 修复流程 ═══════════════
    this.addTemplate({
      id: 'bug-fix',
      name: 'Bug 修复流程',
      description: '定位问题根因并修复，含回归验证',
      nodes: [
        {
          id: 'analyze',
          name: '问题分析',
          type: 'specify',
          description: '复现并分析问题根因',
          agentRole: 'planner',
          skillIds: [],
          roleStatement: '你是问题诊断专家。根据 Bug 报告或错误日志，分析问题的根本原因，定位到具体的代码位置，并提出修复方案。',
          prompt: '你是问题诊断专家。根据 Bug 报告或错误日志，分析问题的根本原因，定位到具体的代码位置，并提出修复方案。\n\n你必须产出以下交付物：\n1. 「根因分析报告」— 使用 ## 根因分析报告 标题，包含问题复现步骤、根因定位、影响范围\n2. 「修复方案」— 使用 ## 修复方案 标题，包含修复策略、涉及文件、预期效果',
          inputs: [],
          outputContracts: [
            { id: 'oc_bf_analysis', title: '根因分析报告', category: 'document', format: 'markdown', required: true },
            { id: 'oc_bf_fix_plan', title: '修复方案', category: 'document', format: 'markdown', required: true },
          ],
          exitConditions: [
            { type: 'output_contains', value: '根因', description: '必须明确指出问题根因' },
          ],
        },
        {
          id: 'fix',
          name: '修复实现',
          type: 'implement',
          description: '根据修复方案编写修复代码',
          agentRole: 'executor',
          skillIds: [],
          roleStatement: '你是修复工程师。严格按照修复方案实施代码修改，修复范围不得超出方案指定的范围（防止引入新问题）。',
          prompt: '你是修复工程师。严格按照修复方案实施代码修改，修复范围不得超出方案指定的范围（防止引入新问题）。\n\n你必须产出以下交付物：\n1. 「修复代码」— 使用 ```typescript:src/路径/文件名.ts 代码块标记每个修改的文件\n2. 「变更说明」— 使用 ## 变更说明 标题，描述修改内容和修复原理',
          inputs: ['analyze.oc_bf_analysis', 'analyze.oc_bf_fix_plan'],
          outputContracts: [
            { id: 'oc_bf_code', title: '修复代码', category: 'code', format: 'typescript', required: true },
            { id: 'oc_bf_change_log', title: '变更说明', category: 'document', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'analyze.oc_bf_fix_plan', description: '修复方案必须已产出' },
          ],
        },
        {
          id: 'verify',
          name: '回归验证',
          type: 'test',
          description: '验证修复有效且无回归问题',
          agentRole: 'executor',
          skillIds: [],
          roleStatement: '你是回归测试工程师。验证两件事：1) 原始 Bug 已被修复；2) 修复未引入新的问题。必须同时覆盖修复路径和相关影响路径。',
          prompt: '你是回归测试工程师。验证两件事：1) 原始 Bug 已被修复；2) 修复未引入新的问题。必须同时覆盖修复路径和相关影响路径。\n\n你必须产出以下交付物：\n1. 「回归测试报告」— 使用 ## 回归测试报告 标题，包含测试用例、Bug 修复验证结果、回归影响检查结果',
          inputs: ['fix.oc_bf_code', 'analyze.oc_bf_analysis'],
          outputContracts: [
            { id: 'oc_bf_test', title: '回归测试报告', category: 'test', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'fix.oc_bf_code', description: '修复代码必须已产出' },
          ],
          exitConditions: [
            { type: 'test_pass', value: '', description: '回归测试必须全部通过' },
          ],
        },
        {
          id: 'deliver',
          name: '交付汇总',
          type: 'deliver',
          description: '汇总 Bug 修复成果',
          agentRole: 'manager',
          skillIds: [],
          roleStatement: '你是交付经理。汇总本次 Bug 修复的全过程：根因、修复方案、代码变更、回归验证结果，生成完整的修复报告。',
          prompt: '你是交付经理。汇总本次 Bug 修复的全过程：根因、修复方案、代码变更、回归验证结果，生成完整的修复报告。\n\n你必须产出以下交付物：\n1. 「修复交付报告」— 使用 ## 修复交付报告 标题，包含问题描述、根因、修复方案、代码变更汇总、回归验证结果',
          inputs: ['analyze.*', 'fix.*', 'verify.*'],
          outputContracts: [
            { id: 'oc_bf_report', title: '修复交付报告', category: 'report', format: 'markdown', required: true },
          ],
        },
      ],
      edges: [
        { source: 'analyze', target: 'fix' },
        { source: 'fix', target: 'verify' },
        { source: 'verify', target: 'deliver' },
      ],
    })

    // ═══════════════ 前后端并行开发 ═══════════════
    this.addTemplate({
      id: 'parallel-dev',
      name: '前后端并行开发',
      description: '前端和后端可并行开发，最后集成测试。适合有明确接口契约的全栈功能开发',
      nodes: [
        {
          id: 'design',
          name: '接口设计',
          type: 'design',
          description: '设计前后端交互接口，确立双方共同遵守的数据契约',
          agentRole: 'planner',
          skillIds: [],
          roleStatement: '你是接口架构师。设计前后端之间的 API 契约，这份契约是前端和后端并行开发时的唯一沟通标准。你产出的接口定义必须足够精确，让两端无需额外沟通即可独立开发。',
          prompt: '你是接口架构师。设计前后端之间的 API 契约，这份契约是前端和后端并行开发时的唯一沟通标准。你产出的接口定义必须足够精确，让两端无需额外沟通即可独立开发。\n\n你必须产出以下交付物：\n1. 「API 接口定义」— 使用 ## API 接口定义 标题，包含所有 API 的 URL、方法、请求/响应格式\n2. 「数据模型 Schema」— 使用 ```typescript:src/types/api-schema.ts 代码块，包含 TypeScript 类型定义\n3. 「Mock 数据规范」（可选）— 使用 ## Mock 数据规范 标题，定义前端开发时使用的 Mock 数据格式',
          inputs: [],
          outputContracts: [
            { id: 'oc_pd_api', title: 'API 接口定义', category: 'document', format: 'markdown', required: true },
            { id: 'oc_pd_schema', title: '数据模型 Schema', category: 'code', format: 'typescript', required: true },
            { id: 'oc_pd_mock', title: 'Mock 数据规范', category: 'document', format: 'markdown', required: false },
          ],
        },
        {
          id: 'frontend',
          name: '前端实现',
          type: 'implement',
          description: '实现前端页面和交互逻辑',
          agentRole: 'executor',
          skillIds: [],
          roleStatement: '你是前端开发工程师。根据接口定义实现前端页面和交互逻辑。在后端未完成时使用 Mock 数据开发，确保接口调用方式与定义完全一致。',
          prompt: '你是前端开发工程师。根据接口定义实现前端页面和交互逻辑。在后端未完成时使用 Mock 数据开发，确保接口调用方式与定义完全一致。\n\n你必须产出以下交付物：\n1. 「前端代码」— 使用 ```typescript:src/pages/文件名.tsx 或 ```typescript:src/components/文件名.tsx 代码块标记\n2. 「前端变更说明」— 使用 ## 前端变更说明 标题，描述页面结构、组件设计、接口调用方式',
          inputs: ['design.oc_pd_api', 'design.oc_pd_schema', 'design.oc_pd_mock'],
          outputContracts: [
            { id: 'oc_pd_fe_code', title: '前端代码', category: 'code', format: 'typescript', required: true },
            { id: 'oc_pd_fe_change_log', title: '前端变更说明', category: 'document', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'design.oc_pd_api', description: '接口定义必须已产出' },
          ],
        },
        {
          id: 'backend',
          name: '后端实现',
          type: 'implement',
          description: '实现后端 API 服务',
          agentRole: 'executor',
          skillIds: [],
          roleStatement: '你是后端开发工程师。根据接口定义实现后端 API。你必须严格按照 Schema 定义的请求/响应格式实现，不得私自新增或修改接口字段。',
          prompt: '你是后端开发工程师。根据接口定义实现后端 API。你必须严格按照 Schema 定义的请求/响应格式实现，不得私自新增或修改接口字段。\n\n你必须产出以下交付物：\n1. 「后端代码」— 使用 ```typescript:src/routes/文件名.ts 或 ```typescript:src/services/文件名.ts 代码块标记\n2. 「后端变更说明」— 使用 ## 后端变更说明 标题，描述 API 实现逻辑、数据库操作、错误处理',
          inputs: ['design.oc_pd_api', 'design.oc_pd_schema'],
          outputContracts: [
            { id: 'oc_pd_be_code', title: '后端代码', category: 'code', format: 'typescript', required: true },
            { id: 'oc_pd_be_change_log', title: '后端变更说明', category: 'document', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'design.oc_pd_api', description: '接口定义必须已产出' },
          ],
        },
        {
          id: 'integrate',
          name: '集成测试',
          type: 'test',
          description: '前后端联调，验证接口对接正确',
          agentRole: 'executor',
          skillIds: [],
          roleStatement: '你是集成测试工程师。前后端代码都已完成，你需要验证：1) 前端调用的接口格式与后端实现一致；2) 数据流转正确；3) 错误处理符合预期。',
          prompt: '你是集成测试工程师。前后端代码都已完成，你需要验证：1) 前端调用的接口格式与后端实现一致；2) 数据流转正确；3) 错误处理符合预期。\n\n你必须产出以下交付物：\n1. 「集成测试报告」— 使用 ## 集成测试报告 标题，包含测试场景、接口对接验证结果、数据流转检查、问题列表',
          inputs: ['frontend.oc_pd_fe_code', 'backend.oc_pd_be_code', 'design.oc_pd_api'],
          outputContracts: [
            { id: 'oc_pd_test', title: '集成测试报告', category: 'test', format: 'markdown', required: true },
          ],
          entryConditions: [
            { type: 'artifact_exists', value: 'frontend.oc_pd_fe_code', description: '前端代码必须已产出' },
            { type: 'artifact_exists', value: 'backend.oc_pd_be_code', description: '后端代码必须已产出' },
          ],
          exitConditions: [
            { type: 'test_pass', value: '', description: '集成测试必须通过' },
          ],
        },
        {
          id: 'deliver',
          name: '交付汇总',
          type: 'deliver',
          description: '汇总前后端实现和集成测试成果',
          agentRole: 'manager',
          skillIds: [],
          roleStatement: '你是交付经理。汇总本次并行开发的全部产出物：接口定义、前端实现、后端实现、集成测试结果，生成完整交付报告。',
          prompt: '你是交付经理。汇总本次并行开发的全部产出物：接口定义、前端实现、后端实现、集成测试结果，生成完整交付报告。\n\n你必须产出以下交付物：\n1. 「交付报告」— 使用 ## 交付报告 标题，包含项目概述、接口设计汇总、前后端实现成果、集成测试结果、遗留问题',
          inputs: ['design.*', 'frontend.*', 'backend.*', 'integrate.*'],
          outputContracts: [
            { id: 'oc_pd_report', title: '交付报告', category: 'report', format: 'markdown', required: true },
          ],
        },
      ],
      edges: [
        { source: 'design', target: 'frontend' },
        { source: 'design', target: 'backend' },
        { source: 'frontend', target: 'integrate' },
        { source: 'backend', target: 'integrate' },
        { source: 'integrate', target: 'deliver' },
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
