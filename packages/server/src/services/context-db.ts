import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import type { ContextLayer } from '../types/index.js'

const CONTEXT_LEVELS = new Set<ContextLayer['level']>(['SYS', 'L0', 'L1', 'L2'])

export class ContextPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContextPathError'
  }
}

/**
 * ContextDBService — 四层精准上下文数据库
 * 
 * 参考 MRF §8 精准上下文数据库设计：
 * 
 * 四层模型：
 * - SYS: 系统级 — 全局规则、编码规范、安全策略等（所有 Agent 共享）
 * - L0:  项目级 — 项目架构文档、技术栈描述、业务背景等
 * - L1:  模板级 — 特定工作流模板的上下文（如 SDD 流程的阶段说明）
 * - L2:  节点级 — 单个节点的精确上下文（如"前端组件需求细节"）
 * 
 * 装配顺序：SYS → L0 → L1 → L2（越后越具体，优先级越高）
 * 
 * 存储结构（文件系统）：
 *   ~/.agent-flow/context-db/
 *     ├── SYS/
 *     │   ├── coding-standards.md
 *     │   └── security-rules.md
 *     ├── L0/
 *     │   ├── {projectId}/
 *     │   │   ├── architecture.md
 *     │   │   └── tech-stack.md
 *     ├── L1/
 *     │   ├── {templateId}/
 *     │   │   └── sdd-process.md
 *     └── L2/
 *         ├── {nodeId}/
 *         │   └── context.md
 */
export class ContextDBService {
  private basePath: string

  constructor(basePath?: string) {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.basePath = resolve(basePath || join(home, '.agent-flow', 'context-db'))
  }

  private assertSafeSegment(value: string, label: string): void {
    if (
      !value ||
      value === '.' ||
      value === '..' ||
      value.includes('/') ||
      value.includes('\\') ||
      value.includes('\0') ||
      isAbsolute(value)
    ) {
      throw new ContextPathError(`Invalid ${label}: path segments are not allowed`)
    }
  }

  private resolveContextDir(level: ContextLayer['level'], scopeId: string): string {
    if (!CONTEXT_LEVELS.has(level)) {
      throw new ContextPathError(`Invalid context level: ${String(level)}`)
    }
    if (level === 'SYS') {
      if (scopeId !== 'global') throw new ContextPathError('SYS scope must be "global"')
    } else {
      this.assertSafeSegment(scopeId, 'scopeId')
    }

    const dir = resolve(this.basePath, level, ...(level === 'SYS' ? [] : [scopeId]))
    const pathFromBase = relative(this.basePath, dir)
    if (pathFromBase === '..' || pathFromBase.startsWith(`..${sep}`) || isAbsolute(pathFromBase)) {
      throw new ContextPathError('Context path escapes the context database')
    }
    return dir
  }

  private resolveContextFile(level: ContextLayer['level'], scopeId: string, filename: string): string {
    this.assertSafeSegment(filename, 'filename')
    return resolve(this.resolveContextDir(level, scopeId), filename)
  }

  /**
   * 初始化目录结构 + 预置默认内容
   */
  async initialize(): Promise<void> {
    await mkdir(join(this.basePath, 'SYS'), { recursive: true })
    await mkdir(join(this.basePath, 'L0'), { recursive: true })
    await mkdir(join(this.basePath, 'L1'), { recursive: true })
    await mkdir(join(this.basePath, 'L2'), { recursive: true })

    // 预置 SYS 全局上下文（仅在文件不存在时写入，不覆盖用户修改）
    await this.seedIfNotExists('SYS', 'global', 'coding-standards.md', SYS_CODING_STANDARDS)
    await this.seedIfNotExists('SYS', 'global', 'security-rules.md', SYS_SECURITY_RULES)
    await this.seedIfNotExists('SYS', 'global', 'output-format.md', SYS_OUTPUT_FORMAT)
    await this.seedIfNotExists('SYS', 'global', 'agent-behavior.md', SYS_AGENT_BEHAVIOR)

    // 预置 L1 模板级协作协议
    await this.seedIfNotExists('L1', 'sdd-standard', 'collaboration-protocol.md', L1_SDD_STANDARD)
    await this.seedIfNotExists('L1', 'quick-feature', 'collaboration-protocol.md', L1_QUICK_FEATURE)
    await this.seedIfNotExists('L1', 'bug-fix', 'collaboration-protocol.md', L1_BUG_FIX)
    await this.seedIfNotExists('L1', 'parallel-dev', 'collaboration-protocol.md', L1_PARALLEL_DEV)
  }

  /**
   * 仅在文件不存在时写入（不覆盖用户自定义内容）
   */
  private async seedIfNotExists(level: string, scopeId: string, filename: string, content: string): Promise<void> {
    const dir = level === 'SYS' ? join(this.basePath, 'SYS') : join(this.basePath, level, scopeId)
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, filename)
    try {
      await readFile(filePath, 'utf-8')
      // 文件存在，不覆盖
    } catch {
      // 文件不存在，写入默认内容
      await writeFile(filePath, content, 'utf-8')
    }
  }

  // ═══════════════ L0 / L2 种子文件生成 ═══════════════

  /**
   * 为新创建的项目预置 L0 种子文件
   * 生成 architecture.md 和 tech-stack.md 引导模板
   * 仅在文件不存在时写入（不覆盖用户修改）
   */
  async seedL0ForProject(projectId: string, projectName: string): Promise<void> {
    const architectureContent = L0_ARCHITECTURE_TEMPLATE.replace(/\{\{projectName\}\}/g, projectName)
    const techStackContent = L0_TECH_STACK_TEMPLATE.replace(/\{\{projectName\}\}/g, projectName)

    await this.seedIfNotExists('L0', projectId, 'architecture.md', architectureContent)
    await this.seedIfNotExists('L0', projectId, 'tech-stack.md', techStackContent)
  }

  /**
   * 为 Run 中的每个节点预置 L2 种子文件
   * 根据节点的模板信息（名称、描述、角色、输入输出契约等）动态生成对应的 context.md
   * 仅在文件不存在时写入（不覆盖用户修改）
   */
  async seedL2ForNode(nodeId: string, nodeInfo: {
    name: string
    type: string
    description: string
    agentRole: string
    roleStatement?: string
    inputs?: string[]
    outputContracts?: Array<{ id: string; title: string; category: string; format: string; required: boolean }>
    exitConditions?: Array<{ type: string; value: string; description?: string }>
  }): Promise<void> {
    const content = this.generateL2Template(nodeInfo)
    await this.seedIfNotExists('L2', nodeId, 'context.md', content)
  }

  /**
   * 批量为 Run 的所有节点生成 L2 种子文件
   */
  async seedL2ForRun(nodes: Array<{
    id: string
    name: string
    type: string
    description: string
    agentRole: string
    roleStatement?: string
    inputs?: string[]
    outputContracts?: Array<{ id: string; title: string; category: string; format: string; required: boolean }>
    exitConditions?: Array<{ type: string; value: string; description?: string }>
  }>): Promise<void> {
    for (const node of nodes) {
      await this.seedL2ForNode(node.id, node)
    }
  }

  /**
   * 根据节点模板信息动态生成 L2 context.md 内容
   */
  private generateL2Template(nodeInfo: {
    name: string
    type: string
    description: string
    agentRole: string
    roleStatement?: string
    inputs?: string[]
    outputContracts?: Array<{ id: string; title: string; category: string; format: string; required: boolean }>
    exitConditions?: Array<{ type: string; value: string; description?: string }>
  }): string {
    const sections: string[] = []

    // 标题和基本信息
    sections.push(`# ${nodeInfo.name} — 节点上下文\n`)
    sections.push(`> 本文件为节点级精确上下文（L2 层），用于向 Agent 提供本节点的具体任务细节。`)
    sections.push(`> 请根据实际需求填写以下各节内容，Agent 执行时会读取本文件获取精确指令。\n`)

    // 节点概述
    sections.push(`## 节点概述\n`)
    sections.push(`- **节点名称**: ${nodeInfo.name}`)
    sections.push(`- **节点类型**: ${nodeInfo.type}`)
    sections.push(`- **Agent 角色**: ${nodeInfo.agentRole}`)
    sections.push(`- **职责描述**: ${nodeInfo.description}\n`)

    // 本次任务目标
    sections.push(`## 本次任务目标\n`)
    sections.push(`<!-- 请在此描述本次执行的具体目标，例如：`)
    sections.push(`  - 要分析的具体需求是什么？`)
    sections.push(`  - 要实现的具体功能是什么？`)
    sections.push(`  - 有什么特殊约束或偏好？`)
    sections.push(`-->`)
    sections.push(`\n（待填写）\n`)

    // 输入依赖提示
    if (nodeInfo.inputs && nodeInfo.inputs.length > 0) {
      sections.push(`## 输入依赖\n`)
      sections.push(`本节点依赖以下前置产出物：\n`)
      for (const input of nodeInfo.inputs) {
        sections.push(`- \`${input}\``)
      }
      sections.push(`\n<!-- 如有特殊说明，如何使用上述输入，请在此补充 -->\n`)
    }

    // 产出物要求
    if (nodeInfo.outputContracts && nodeInfo.outputContracts.length > 0) {
      sections.push(`## 产出物要求\n`)
      sections.push(`本节点需要产出以下交付物：\n`)
      sections.push(`| 产出物 | 类别 | 格式 | 必需 |`)
      sections.push(`|--------|------|------|------|`)
      for (const oc of nodeInfo.outputContracts) {
        sections.push(`| ${oc.title} | ${oc.category} | ${oc.format} | ${oc.required ? '✅' : '⬜'} |`)
      }
      sections.push(`\n<!-- 如对产出物有额外要求（如命名规范、目录结构），请在此补充 -->\n`)
    }

    // 准出条件
    if (nodeInfo.exitConditions && nodeInfo.exitConditions.length > 0) {
      sections.push(`## 完成标准\n`)
      sections.push(`除产出物外，本节点还需满足以下条件：\n`)
      for (const ec of nodeInfo.exitConditions) {
        const desc = ec.description || ec.value
        sections.push(`- [${ec.type}] ${desc}`)
      }
      sections.push('')
    }

    // 补充上下文
    sections.push(`## 补充上下文\n`)
    sections.push(`<!-- 请在此添加任何有助于 Agent 执行本节点任务的额外信息，例如：`)

    // 根据节点类型给出差异化的引导提示
    switch (nodeInfo.type) {
      case 'specify':
        sections.push(`  - 用户原始需求描述`)
        sections.push(`  - 业务背景和目标用户`)
        sections.push(`  - 已知的技术约束`)
        sections.push(`  - 竞品参考或设计稿链接`)
        break
      case 'design':
        sections.push(`  - 系统现有架构说明`)
        sections.push(`  - 技术选型偏好或约束`)
        sections.push(`  - 性能/可扩展性要求`)
        sections.push(`  - 需要兼容的已有接口`)
        break
      case 'task_split':
        sections.push(`  - 人力分配和时间约束`)
        sections.push(`  - 任务优先级排序标准`)
        sections.push(`  - 需要跳过或延后的模块`)
        break
      case 'implement':
        sections.push(`  - 代码仓库地址和分支策略`)
        sections.push(`  - 本地开发环境配置说明`)
        sections.push(`  - 需要特别注意的代码区域`)
        sections.push(`  - 已知的技术债务或 workaround`)
        break
      case 'review':
        sections.push(`  - 审查重点关注的方面`)
        sections.push(`  - 已知的风险点`)
        sections.push(`  - 团队编码惯例参考`)
        break
      case 'test':
        sections.push(`  - 测试环境配置`)
        sections.push(`  - 关键测试场景补充`)
        sections.push(`  - 已知的不稳定测试用例`)
        break
      case 'deliver':
        sections.push(`  - 部署目标环境`)
        sections.push(`  - 上线检查清单`)
        sections.push(`  - 回滚方案`)
        break
      default:
        sections.push(`  - 本节点的特定业务逻辑`)
        sections.push(`  - 相关文档或参考资料链接`)
        sections.push(`  - 需要注意的边界情况`)
        break
    }

    sections.push(`-->\n`)
    sections.push(`（待填写）\n`)

    return sections.join('\n')
  }

  // ═══════════════ CRUD 操作 ═══════════════

  /**
   * 创建/更新上下文文件
   */
  async upsertContext(
    level: ContextLayer['level'],
    scopeId: string,         // SYS: 'global', L0: projectId, L1: templateId, L2: nodeId
    filename: string,        // 文件名（如 "architecture.md"）
    content: string
  ): Promise<{ path: string }> {
    const dir = this.resolveContextDir(level, scopeId)
    const filePath = this.resolveContextFile(level, scopeId, filename)
    
    await mkdir(dir, { recursive: true })
    await writeFile(filePath, content, 'utf-8')
    
    return { path: filePath }
  }

  /**
   * 读取上下文文件
   */
  async getContext(
    level: ContextLayer['level'],
    scopeId: string,
    filename: string
  ): Promise<string | null> {
    const filePath = this.resolveContextFile(level, scopeId, filename)
    try {
      const content = await readFile(filePath, 'utf-8')
      return content
    } catch {
      return null
    }
  }

  /**
   * 列出某层级某 scope 下的所有上下文文件
   */
  async listContextFiles(
    level: ContextLayer['level'],
    scopeId: string
  ): Promise<Array<{ filename: string; level: ContextLayer['level']; scopeId: string; size: number }>> {
    const dir = this.resolveContextDir(level, scopeId)
    try {
      const files = await readdir(dir, { withFileTypes: true })
      const result: Array<{ filename: string; level: ContextLayer['level']; scopeId: string; size: number }> = []
      
      for (const file of files) {
        if (file.isFile()) {
          try {
            const content = await readFile(join(dir, file.name), 'utf-8')
            result.push({
              filename: file.name,
              level,
              scopeId,
              size: content.length,
            })
          } catch {
            // skip unreadable files
          }
        }
      }
      
      return result
    } catch {
      return []
    }
  }

  /**
   * 按 runId 前缀批量列出所有 L2 文件（该 Run 的所有节点）
   */
  async listL2FilesByRunId(
    runId: string
  ): Promise<Array<{ filename: string; level: 'L2'; scopeId: string; size: number; nodeName: string }>> {
    this.assertSafeSegment(runId, 'runId')
    try {
      const l2Dir = join(this.basePath, 'L2')
      const allDirs = await readdir(l2Dir, { withFileTypes: true })
      const result: Array<{ filename: string; level: 'L2'; scopeId: string; size: number; nodeName: string }> = []

      for (const dir of allDirs) {
        if (dir.isDirectory() && dir.name.startsWith(`${runId}_`)) {
          const nodeId = dir.name
          // 从 nodeId 中提取节点名：run_xxx_specify → specify
          const nodeName = nodeId.replace(`${runId}_`, '')
          const nodeDir = join(l2Dir, nodeId)
          const files = await readdir(nodeDir, { withFileTypes: true })
          for (const file of files) {
            if (file.isFile()) {
              try {
                const content = await readFile(join(nodeDir, file.name), 'utf-8')
                result.push({
                  filename: file.name,
                  level: 'L2',
                  scopeId: nodeId,
                  size: content.length,
                  nodeName,
                })
              } catch {
                // skip unreadable
              }
            }
          }
        }
      }

      return result
    } catch {
      return []
    }
  }

  /**
   * 删除上下文文件
   */
  async deleteContext(
    level: ContextLayer['level'],
    scopeId: string,
    filename: string
  ): Promise<boolean> {
    const filePath = this.resolveContextFile(level, scopeId, filename)
    try {
      await unlink(filePath)
      return true
    } catch {
      return false
    }
  }

  // ═══════════════ 装配引擎 ═══════════════

  /**
   * 装配上下文 — 按 SYS → L0 → L1 → L2 顺序聚合所有相关上下文
   * 
   * @param projectId - 项目 ID（用于 L0）
   * @param templateId - 模板 ID（用于 L1）
   * @param nodeId - 节点 ID（用于 L2）
   * @returns 按层级排序的完整上下文列表
   */
  async assembleContext(params: {
    projectId?: string
    templateId?: string
    nodeId?: string
  }): Promise<ContextLayer[]> {
    const { projectId, templateId, nodeId } = params
    const layers: ContextLayer[] = []

    // Layer SYS: 系统级（始终包含）
    const sysFiles = await this.listContextFiles('SYS', 'global')
    for (const file of sysFiles) {
      const content = await this.getContext('SYS', 'global', file.filename)
      if (content) {
        layers.push({
          level: 'SYS',
          content,
          source: `SYS/${file.filename}`,
        })
      }
    }

    // Layer L0: 项目级
    if (projectId) {
      const l0Files = await this.listContextFiles('L0', projectId)
      for (const file of l0Files) {
        const content = await this.getContext('L0', projectId, file.filename)
        if (content) {
          layers.push({
            level: 'L0',
            content,
            source: `L0/${projectId}/${file.filename}`,
          })
        }
      }
    }

    // Layer L1: 模板级
    if (templateId) {
      const l1Files = await this.listContextFiles('L1', templateId)
      for (const file of l1Files) {
        const content = await this.getContext('L1', templateId, file.filename)
        if (content) {
          layers.push({
            level: 'L1',
            content,
            source: `L1/${templateId}/${file.filename}`,
          })
        }
      }
    }

    // Layer L2: 节点级
    if (nodeId) {
      const l2Files = await this.listContextFiles('L2', nodeId)
      for (const file of l2Files) {
        const content = await this.getContext('L2', nodeId, file.filename)
        if (content) {
          layers.push({
            level: 'L2',
            content,
            source: `L2/${nodeId}/${file.filename}`,
          })
        }
      }
    }

    return layers
  }

  /**
   * 将装配后的上下文格式化为单个字符串（注入到 Agent prompt）
   */
  formatAssembledContext(layers: ContextLayer[]): string {
    if (layers.length === 0) return ''

    const levelLabels: Record<string, string> = {
      SYS: '系统规则',
      L0: '项目上下文',
      L1: '流程上下文',
      L2: '节点上下文',
    }

    const sections: string[] = []
    let currentLevel = ''

    for (const layer of layers) {
      if (layer.level !== currentLevel) {
        currentLevel = layer.level
        sections.push(`\n### ${levelLabels[layer.level] || layer.level}\n`)
      }
      sections.push(layer.content)
    }

    return `## 上下文数据库\n${sections.join('\n')}`
  }

  /**
   * 获取所有层级的统计信息
   */
  async getStats(): Promise<{
    sys: number
    l0: number
    l1: number
    l2: number
    totalFiles: number
  }> {
    const sysFiles = await this.listContextFiles('SYS', 'global')
    
    let l0Count = 0
    let l1Count = 0
    let l2Count = 0

    try {
      const l0Dirs = await readdir(join(this.basePath, 'L0'), { withFileTypes: true })
      for (const dir of l0Dirs) {
        if (dir.isDirectory()) {
          const files = await this.listContextFiles('L0', dir.name)
          l0Count += files.length
        }
      }
    } catch { /* empty */ }

    try {
      const l1Dirs = await readdir(join(this.basePath, 'L1'), { withFileTypes: true })
      for (const dir of l1Dirs) {
        if (dir.isDirectory()) {
          const files = await this.listContextFiles('L1', dir.name)
          l1Count += files.length
        }
      }
    } catch { /* empty */ }

    try {
      const l2Dirs = await readdir(join(this.basePath, 'L2'), { withFileTypes: true })
      for (const dir of l2Dirs) {
        if (dir.isDirectory()) {
          const files = await this.listContextFiles('L2', dir.name)
          l2Count += files.length
        }
      }
    } catch { /* empty */ }

    return {
      sys: sysFiles.length,
      l0: l0Count,
      l1: l1Count,
      l2: l2Count,
      totalFiles: sysFiles.length + l0Count + l1Count + l2Count,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 预置内容常量 — SYS 全局上下文
// ═══════════════════════════════════════════════════════════════════════════════

const SYS_CODING_STANDARDS = `# 编码规范（全局）

本规范适用于所有项目、所有语言。项目级的具体规范（如使用 React 还是 Vue）由 L0 层定义。

## 通用原则

- 代码必须可读、可维护、可测试
- 函数/方法单一职责，不超过 50 行（特殊情况可放宽至 80 行）
- 禁止硬编码魔法数字和魔法字符串，必须使用常量或枚举
- 所有公开 API 必须有注释说明其用途、参数、返回值
- 命名清晰自解释，禁止使用单字母变量（循环变量 i/j/k 除外）

## 类型安全

- TypeScript 项目：strict mode 必须开启，禁止使用 any（可用 unknown + type guard）
- Java 项目：禁止裸用 Object 类型，使用泛型
- Go 项目：error 必须处理，禁止 _ 忽略 error

## 错误处理

- 所有可能失败的操作必须有错误处理
- 禁止空 catch / 吞异常
- 错误消息必须包含足够的上下文信息（什么操作、什么输入、什么错误）
- 区分"可恢复错误"和"致命错误"，分别处理

## 代码组织

- 相关的代码放在一起（按功能/领域组织，非按类型组织）
- 导入语句分组：内置模块 → 第三方依赖 → 项目内部模块
- 避免循环依赖

## 测试

- 核心业务逻辑必须有单元测试
- 测试用例覆盖正常路径 + 边界条件 + 异常路径
- 测试代码与生产代码同等重要，同样需要可读可维护
`

const SYS_SECURITY_RULES = `# 安全规则（全局）

以下规则为硬性要求，所有 Agent 在任何情况下都不得违反。

## 敏感信息

- 禁止在代码中硬编码任何凭证（API Key、密码、Token、证书）
- 敏感信息必须通过环境变量或密钥管理服务获取
- 日志输出禁止包含用户密码、完整信用卡号、身份证号等 PII 信息
- 配置文件中的敏感字段必须使用占位符（如 \${DB_PASSWORD}）

## 输入验证

- 所有外部输入（用户输入、API 参数、文件内容）必须验证后使用
- 防止 SQL 注入：使用参数化查询，禁止字符串拼接 SQL
- 防止 XSS：输出到 HTML 时必须转义
- 防止路径遍历：文件操作前验证路径不超出允许范围

## 依赖管理

- 不引入已知有高危漏洞的依赖版本
- 新增依赖前评估其维护状态和安全记录
- 锁定依赖版本（lock file 必须提交）

## 权限最小化

- 文件权限遵循最小必要原则
- 数据库连接使用最小权限账户
- API 接口遵循最小暴露原则（内部接口不对外暴露）

## 加密

- 密码存储必须使用加盐哈希（bcrypt/argon2），禁止明文或 MD5
- 数据传输使用 HTTPS/TLS
- 敏感数据存储使用 AES-256 或同等强度加密
`

const SYS_OUTPUT_FORMAT = `# 输出格式规范（全局）

Agent 的所有产出物必须遵循以下格式标准，确保下游节点能正确解析和使用。

## Markdown 文档

- 使用标准 CommonMark 格式
- 文档必须有一级标题（# 标题）
- 章节使用二级标题（##）分隔
- 代码块必须指定语言（\`\`\`typescript / \`\`\`java / \`\`\`go 等）
- 表格使用标准 Markdown 表格语法

## 代码产出

- 每个代码文件必须说明其用途（文件头注释或在变更说明中描述）
- 变更说明必须列出所有新增/修改/删除的文件路径
- 代码产出物中如果涉及多个文件，按功能模块分组说明

## 变更说明格式

变更说明文档必须包含以下结构：

\`\`\`markdown
# 变更说明

## 概述
简要描述本次变更的目的和范围

## 变更文件清单
| 文件路径 | 操作 | 说明 |
|---------|------|------|
| src/xxx | 新增 | xxx |

## 关键决策
列出实现过程中做出的重要技术决策及原因

## 遗留问题（如有）
已知但本次未解决的问题
\`\`\`

## 测试报告格式

\`\`\`markdown
# 测试报告

## 测试概览
- 测试用例总数：X
- 通过：X | 失败：X | 跳过：X

## 测试详情
### 正常路径
...
### 异常路径
...
### 边界条件
...

## 结论
PASS / FAIL + 原因
\`\`\`
`

const SYS_AGENT_BEHAVIOR = `# Agent 行为准则（全局）

定义所有 Agent 在执行任务时的行为规范。

## 不确定时必须询问

- 当需求存在歧义，且你的两种理解会导致完全不同的实现方向时，必须向用户提问
- 当你不确定某个技术决策是否符合项目惯例时，必须查看现有代码或询问
- 但是：细节层面的不确定（如变量命名选择）应自行决定，不要过度提问

## 变更范围控制

- 只修改与当前任务直接相关的代码
- 如果发现了不属于当前任务的问题（如已有 Bug），记录在变更说明中但不修复
- 禁止"顺手重构"——除非重构是完成当前任务的必要前提

## 产出物完整性

- 每个节点必须产出其 outputContracts 中所有 required=true 的产出物
- 产出物内容必须与契约描述一致（标题、格式、类别）
- 如果无法产出某个必需产出物，必须在输出中明确说明原因和影响

## 前置产出物使用

- 必须阅读并遵循 inputs 中声明的所有前置产出物
- 你的实现不得与前置节点的产出物相矛盾
- 如果发现前置产出物有问题，在变更说明中提出，但仍按其指示执行

## 幂等性

- 同一任务重复执行应产生相同结果
- 不得依赖外部可变状态（如当前时间、随机数）作为业务逻辑依据
- 文件操作必须是幂等的（创建前检查是否存在、更新用覆盖而非追加）
`

// ═══════════════════════════════════════════════════════════════════════════════
// 预置内容常量 — L1 模板级协作协议
// ═══════════════════════════════════════════════════════════════════════════════

const L1_SDD_STANDARD = `# 标准 SDD 开发流程 — 协作协议

本文件定义"标准 SDD 开发流程"中各节点之间的协作规则、数据流契约和质量基线。
每个节点的 Agent 在执行时会读到这份协议，确保节点间衔接顺畅。

## 流程概览

\`\`\`
specify → design → task_split → implement → review → test → deliver
\`\`\`

## 数据流契约

### specify → design
- 需求文档中的每个功能点必须有唯一编号（格式：F-001, F-002...）
- design 节点必须对每个功能点给出技术实现方案
- 验收标准直接传递给 test 节点作为测试依据

### design → task_split
- 接口定义使用目标语言的类型系统（TypeScript interface / Java interface / Go interface）
- task_split 按接口粒度拆分子任务：一个接口/模块 = 一个子任务
- 数据模型如果是可选产出物未产出，task_split 需要在子任务中标注"需要自行设计数据模型"

### task_split → implement
- 任务清单中每个子任务必须包含：目标描述、关联的接口定义引用、预期文件路径
- implement 节点按子任务顺序逐个实现，每完成一个在变更说明中标注

### implement → review
- 变更说明必须包含完整的文件路径清单
- review 逐文件检查，重点对比接口定义与实际实现的一致性
- review 不检查代码风格（由 SYS 层的 lint 规则和自动化工具保证）

### review → test
- 审查结论必须明确：APPROVED（通过）或 REJECTED（拒绝 + 原因）
- 只有 APPROVED 状态才能流转到 test（由 entryCondition 保证）
- 如果 REJECTED，需要人工决定是回退到 implement 还是跳过

### test → deliver
- 测试报告必须对照验收标准逐项确认
- 每个验收标准对应至少一个测试用例
- deliver 节点汇总时检查：所有验收标准是否都有对应的 PASS 状态

## 质量基线

| 指标 | 标准 | 强制/建议 |
|------|------|----------|
| 接口定义覆盖率 | 需求文档中每个 F-xxx 都有对应接口 | 强制 |
| 任务拆分粒度 | 单个子任务对应 ≤ 300 行代码变更 | 建议 |
| 变更说明完整性 | 每个修改的文件都有说明 | 强制 |
| 测试覆盖率 | 核心功能路径 100%，边界条件 ≥ 60% | 强制 |
| 审查通过条件 | 0 个 blocking issue | 强制 |

## 冲突解决规则

- 当 implement 发现 design 的接口定义不合理时：不得自行修改接口，在变更说明中产出"设计反馈"段落，标记具体问题和建议修改
- 当 review 发现实现与设计不一致时：标记为 blocking issue，要求 implement 修正
- 当 test 发现验收标准本身有问题时：在测试报告中标注"验收标准疑问"，由人工裁决

## 语言无关说明

本协议适用于任何技术栈。"接口定义"在不同语言中的对应形式：
- TypeScript/JavaScript: interface / type
- Java: interface / abstract class
- Go: interface
- Python: Protocol / ABC
- Rust: trait
`

const L1_QUICK_FEATURE = `# 快速功能迭代 — 协作协议

本流程适用于小功能开发，特点是跳过详细设计和任务拆分，由实现者自行决定技术方案。

## 流程概览

\`\`\`
specify → implement → test → deliver
\`\`\`

## 协作特点

与标准 SDD 流程的关键区别：
- 没有独立的 design 节点：implement 节点自行决定技术方案
- 没有独立的 review 节点：test 节点同时承担审查和测试职责
- 需求文档精简：只需要核心要点，不需要完整的功能点编号体系

## 数据流契约

### specify → implement
- 需求摘要必须明确"做什么"和"不做什么"的边界
- 如果有性能要求或兼容性要求，必须在摘要中说明
- implement 节点有权自行选择实现方案，但必须在变更说明中记录关键决策

### implement → test
- 变更说明必须包含"关键决策"段落，说明为什么选择这个方案
- test 节点同时验证：功能正确性 + 代码基本质量（无明显 bug / 无安全问题）
- 如果 test 发现严重问题，可以直接修复（本流程允许 test 节点修改代码）

### test → deliver
- 测试结果需对照需求摘要中的"做什么"逐项确认
- 如果 test 节点修改了代码，必须在测试报告中说明修改内容

## 质量基线

| 指标 | 标准 | 强制/建议 |
|------|------|----------|
| 需求覆盖 | 摘要中每个"做什么"都有对应实现 | 强制 |
| 关键决策记录 | 至少记录 1 个技术决策 | 强制 |
| 测试覆盖 | 核心功能路径验证 | 强制 |
| 代码变更量 | ≤ 500 行（超过说明需要用标准流程） | 建议 |

## 回退机制

如果在 implement 或 test 过程中发现需求本身不合理，应标记在产出物中并建议：
- 小问题：test 节点直接修复
- 大问题：建议终止本流程，改用标准 SDD 流程重新来过
`

const L1_BUG_FIX = `# Bug 修复流程 — 协作协议

本流程专注于定位并修复已知问题，核心原则是"最小变更"——只修复问题本身，不引入额外改动。

## 流程概览

\`\`\`
analyze → fix → verify → deliver
\`\`\`

## 核心原则

1. **最小变更原则**：修复代码的影响范围必须最小化，不得"顺手"优化或重构
2. **根因驱动**：必须找到根本原因再修复，禁止"症状修复"（workaround）
3. **回归意识**：修复后必须验证不引入新问题

## 数据流契约

### analyze → fix
- 根因分析必须定位到具体的代码文件和行号范围
- 修复方案必须说明：改什么、怎么改、为什么这样改
- 如果有多个修复方案，列出各方案的利弊，选择风险最低的方案
- 修复方案必须评估影响范围（哪些功能/模块可能受影响）

### fix → verify
- 修复代码的变更范围必须与 analyze 的修复方案一致
- 如果实际修复超出了方案范围，必须在变更说明中解释原因
- 变更说明必须包含"影响范围评估"段落

### verify → deliver
- 回归测试必须覆盖：1) 原始 bug 场景 2) 修复方案中评估的影响范围
- 测试报告必须明确：原始问题是否修复 + 影响范围是否无回归

## 质量基线

| 指标 | 标准 | 强制/建议 |
|------|------|----------|
| 根因定位 | 精确到文件 + 函数级别 | 强制 |
| 修复范围 | ≤ 50 行代码变更 | 建议（超过需说明理由） |
| 回归测试 | 覆盖修复路径 + 影响路径 | 强制 |
| 方案一致性 | 实际修复 ≤ 方案描述范围 | 强制 |

## 特殊情况处理

- **根因在第三方依赖中**：分析报告说明 workaround 方案，标注为临时修复，建议后续升级/替换
- **根因需要架构调整**：分析报告说明最小修复方案（治标），同时记录架构问题建议后续处理
- **bug 无法复现**：分析报告说明已尝试的复现步骤，给出"最可能的根因"和"防御性修复方案"
`

const L1_PARALLEL_DEV = `# 前后端并行开发 — 协作协议

本流程的核心特点是前后端同时开发、最后集成。接口定义是双方唯一的"同步点"。

## 流程概览

\`\`\`
design → frontend (并行)
       → backend  (并行) → integrate → deliver
\`\`\`

## 核心原则

1. **契约先行**：接口定义是前后端的唯一沟通标准，一旦定义不可单方面修改
2. **独立可验证**：前端用 Mock 数据、后端用单元测试，各自独立验证
3. **集成兜底**：集成测试是最终防线，验证双方对契约的理解一致

## 数据流契约

### design → frontend / backend（共享）
- API 接口定义必须包含：URL、HTTP 方法、请求参数类型、响应类型、错误码
- 数据模型 Schema 使用目标语言的类型定义（TypeScript type/interface, Java DTO, Go struct 等）
- Mock 数据规范（如产出）定义每个接口的 Mock 响应示例，前端直接使用

### frontend 节点规则
- 必须使用接口定义中的类型进行 API 调用（不允许 any/Object）
- Mock 数据必须符合 Schema 定义的格式
- 组件级别的状态管理只处理前端关注的展示逻辑
- 如果发现接口定义不满足前端需求，在变更说明中记录但不修改接口

### backend 节点规则
- API 响应格式必须严格匹配 Schema 定义
- 不得新增 design 未声明的公开接口字段
- 如果实现中发现需要额外字段，在变更说明中记录建议，但本次不添加
- 错误响应格式也必须与定义一致

### integrate 集成测试重点
- 验证请求参数：前端发送的参数格式 === 后端期望的参数格式
- 验证响应数据：后端返回的数据格式 === 前端解析的数据格式
- 验证错误处理：后端返回错误码时前端的处理行为
- 验证边界情况：空数据、分页、大数据量

## 质量基线

| 指标 | 标准 | 强制/建议 |
|------|------|----------|
| 接口覆盖 | 定义中每个接口都有前后端实现 | 强制 |
| 类型安全 | 前后端引用同一份类型定义（或等价声明） | 强制 |
| Mock 准确性 | Mock 数据符合 Schema | 强制 |
| 集成测试覆盖 | 每个接口至少 1 个正常 + 1 个异常用例 | 强制 |
| 接口变更 | 单方面不得修改，需走设计变更流程 | 强制 |

## 冲突解决

- **前端需要接口定义中没有的字段**：记录在前端变更说明中，集成时由 deliver 节点评估是否需要补充
- **后端无法实现定义中的某个接口行为**：记录在后端变更说明中，同样由 deliver 节点评估
- **前后端对接口理解不一致**（集成时发现）：以 design 节点的原始定义为准，不一致的一方修改

## 语言组合支持

本流程支持任意前后端技术栈组合：
- 前端：React / React Native / Vue / Angular / Flutter / Swift UI / Compose
- 后端：Java (Spring) / Go (Gin/Echo) / Node.js (Express/Nest) / Python (FastAPI/Django) / Rust (Actix)
- 接口格式：REST API (OpenAPI 风格描述) / GraphQL (Schema 定义) / gRPC (Proto 定义)
`

// ═══════════════════════════════════════════════════════════════════════════════
// 预置内容常量 — L0 项目级上下文模板
// ═══════════════════════════════════════════════════════════════════════════════

const L0_ARCHITECTURE_TEMPLATE = `# {{projectName}} — 项目架构文档

> 本文件为项目级上下文（L0 层），描述项目的整体架构。
> 所有在本项目中执行的 Agent 都会读取本文件，了解项目全貌。
> 请根据实际情况填写以下内容。

## 项目概述

<!-- 简要描述项目的目标、业务背景和核心价值 -->

（待填写）

## 架构风格

<!-- 描述项目的整体架构模式，例如：
  - 单体应用 / 微服务 / Serverless / 单页应用 + BFF
  - 分层架构（展示层 → 业务层 → 数据层）
  - 事件驱动 / CQRS / 领域驱动设计
-->

（待填写）

## 目录结构

<!-- 描述项目的关键目录结构，帮助 Agent 快速定位代码位置 -->

\`\`\`
（待填写，示例：）
src/
├── components/    # UI 组件
├── pages/         # 页面
├── services/      # 业务逻辑
├── api/           # API 调用层
├── types/         # 类型定义
└── utils/         # 工具函数
\`\`\`

## 核心模块

<!-- 列出项目的核心模块/服务及其职责 -->

（待填写）

## 数据流

<!-- 描述数据在系统中的流转方式 -->

（待填写）

## 部署架构

<!-- 描述项目的部署环境和拓扑 -->

（待填写）

## 关键约束

<!-- 列出架构层面的硬性约束，例如：
  - 兼容性要求（浏览器版本、Node 版本）
  - 性能指标（首屏加载 < 2s、API 响应 < 200ms）
  - 安全合规要求
-->

（待填写）
`

const L0_TECH_STACK_TEMPLATE = `# {{projectName}} — 技术栈描述

> 本文件为项目级上下文（L0 层），描述项目使用的技术栈。
> Agent 在编写代码时会参考本文件选择正确的库、API 风格和编码惯例。
> 请根据实际情况填写以下内容。

## 语言与运行时

<!-- 列出项目使用的编程语言和运行环境 -->

| 维度 | 选择 | 版本 |
|------|------|------|
| 主语言 | （待填写，如 TypeScript） | （版本号） |
| 运行时 | （待填写，如 Node.js） | （版本号） |
| 包管理 | （待填写，如 pnpm） | （版本号） |

## 框架与核心依赖

<!-- 列出项目的核心框架和关键依赖 -->

| 用途 | 库/框架 | 版本 | 说明 |
|------|---------|------|------|
| 前端框架 | （待填写） | | |
| 后端框架 | （待填写） | | |
| 状态管理 | （待填写） | | |
| 路由 | （待填写） | | |
| UI 组件库 | （待填写） | | |
| HTTP 客户端 | （待填写） | | |
| ORM/数据库 | （待填写） | | |

## 工程化工具

<!-- 描述项目的构建、测试、质量保障工具链 -->

| 工具类型 | 选择 | 配置文件 |
|---------|------|---------|
| 构建工具 | （待填写，如 Vite / Webpack） | |
| 测试框架 | （待填写，如 Vitest / Jest） | |
| Linter | （待填写，如 ESLint） | |
| 格式化 | （待填写，如 Prettier） | |
| CI/CD | （待填写） | |

## 编码惯例

<!-- 描述项目遵循的编码规范和惯例，例如：
  - 命名规范（文件用 kebab-case / 组件用 PascalCase）
  - 导入排序规则
  - 状态管理模式
  - 错误处理模式
  - 日志规范
-->

（待填写）

## 环境配置

<!-- 描述开发环境、测试环境、生产环境的差异 -->

| 环境 | 说明 | 配置方式 |
|------|------|---------|
| 开发环境 | （待填写） | .env.development |
| 测试环境 | （待填写） | .env.test |
| 生产环境 | （待填写） | .env.production |

## 注意事项

<!-- 列出技术栈层面需要特别注意的事项，例如：
  - 不要使用 xxx 库（已废弃/有安全问题）
  - 某个 API 只能在 v4+ 使用
  - 某个配置与另一个冲突
-->

（待填写）
`
