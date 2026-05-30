import type {
  OutputContract, Artifact, ContractValidationResult, ContractCheckResult,
  TaskNode,
} from '../types/index.js'

/**
 * ContractValidatorService — 产出物合同验证引擎
 * 
 * 核心职责：
 * 1. 合同校验：节点完成时自动验证产出物是否满足 OutputContract
 * 2. 结构化匹配：根据 category + format 匹配 Artifact 与 Contract
 * 3. 内容校验（可选）：检查 Artifact 内容是否符合预期格式
 * 4. 阻断/警告：required 合同不满足可阻断节点完成
 * 
 * 验证规则：
 * - required: true 的合同必须有匹配的 Artifact
 * - 匹配逻辑：category 完全匹配 + format 兼容匹配
 * - 一个 Artifact 可以满足多个 Contract（多对多）
 * - 内容非空检查（空 Artifact 不计入满足）
 */
export class ContractValidatorService {

  /**
   * 验证节点的产出物是否满足合同
   * 
   * @param contracts 节点定义的 OutputContract 列表
   * @param artifacts 节点实际产出的 Artifact 列表
   * @returns 验证结果
   */
  validate(nodeId: string, contracts: OutputContract[], artifacts: Artifact[]): ContractValidationResult {
    const results: ContractCheckResult[] = []
    let allPassed = true

    for (const contract of contracts) {
      const check = this.checkContract(contract, artifacts)
      results.push(check)

      if (contract.required && !check.satisfied) {
        allPassed = false
      }
    }

    return {
      nodeId,
      passed: allPassed,
      results,
      validatedAt: Date.now(),
    }
  }

  /**
   * 从 TaskNode 直接验证（便捷方法）
   * 节点的 outputContracts 来自模板，artifacts 来自运行时产出
   */
  validateNode(node: TaskNode, templateContracts?: OutputContract[]): ContractValidationResult {
    const contracts = templateContracts || []
    return this.validate(node.id, contracts, node.artifacts)
  }

  /**
   * 检查单个合同是否被满足
   */
  private checkContract(contract: OutputContract, artifacts: Artifact[]): ContractCheckResult {
    // 查找匹配的 Artifact
    const matched = artifacts.find(artifact => this.matchArtifactToContract(artifact, contract))

    if (matched) {
      // 验证内容非空
      const hasContent = this.hasValidContent(matched)
      return {
        contractId: contract.id,
        title: contract.title,
        required: contract.required,
        satisfied: hasContent,
        matchedArtifact: matched.id,
        reason: hasContent ? undefined : 'Matched artifact has empty content',
      }
    }

    return {
      contractId: contract.id,
      title: contract.title,
      required: contract.required,
      satisfied: false,
      reason: `No artifact matches contract: category="${contract.category}", format="${contract.format}"`,
    }
  }

  /**
   * 匹配 Artifact 到 Contract
   * 
   * 匹配规则（按优先级）：
   * 1. category 完全匹配
   * 2. format 兼容匹配（支持通配和子类型）
   * 3. title 模糊匹配（作为辅助信号）
   */
  private matchArtifactToContract(artifact: Artifact, contract: OutputContract): boolean {
    // 规则1：category 必须匹配
    if (artifact.category !== contract.category) return false

    // 规则2：format 兼容匹配
    if (!this.isFormatCompatible(artifact.format, contract.format)) return false

    return true
  }

  /**
   * 格式兼容性检查
   * 
   * 兼容映射示例：
   * - "typescript" 兼容 "code"
   * - "md" 兼容 "markdown"
   * - "json" 兼容 "config"
   */
  private isFormatCompatible(artifactFormat: string, contractFormat: string): boolean {
    // 完全匹配
    if (artifactFormat === contractFormat) return true

    // 归一化
    const normalizedArtifact = this.normalizeFormat(artifactFormat)
    const normalizedContract = this.normalizeFormat(contractFormat)
    if (normalizedArtifact === normalizedContract) return true

    // 宽松匹配：某些格式属于同一大类
    const formatGroups: Record<string, string[]> = {
      code: ['typescript', 'javascript', 'ts', 'js', 'tsx', 'jsx', 'python', 'go', 'rust', 'java'],
      document: ['markdown', 'md', 'text', 'txt', 'html'],
      config: ['json', 'yaml', 'yml', 'toml', 'ini', 'env'],
      test: ['typescript', 'javascript', 'ts', 'js', 'python'],
    }

    for (const [group, formats] of Object.entries(formatGroups)) {
      if (
        (normalizedContract === group || formats.includes(normalizedContract)) &&
        (normalizedArtifact === group || formats.includes(normalizedArtifact))
      ) {
        return true
      }
    }

    return false
  }

  /**
   * 格式名称归一化
   */
  private normalizeFormat(format: string): string {
    const map: Record<string, string> = {
      ts: 'typescript',
      js: 'javascript',
      md: 'markdown',
      yml: 'yaml',
      txt: 'text',
    }
    return map[format.toLowerCase()] || format.toLowerCase()
  }

  /**
   * 检查 Artifact 内容是否有效（非空）
   */
  private hasValidContent(artifact: Artifact): boolean {
    if (artifact.filePath) return true  // 有文件路径引用就算有内容
    if (artifact.content && artifact.content.trim().length > 0) return true
    return false
  }

  /**
   * 生成验证报告的文字摘要
   */
  formatReport(result: ContractValidationResult): string {
    const lines: string[] = []
    const icon = result.passed ? '✅' : '❌'
    lines.push(`${icon} OutputContract Validation (${result.passed ? 'PASSED' : 'FAILED'})`)
    lines.push(`  Node: ${result.nodeId}`)
    lines.push(`  Time: ${new Date(result.validatedAt).toISOString()}`)
    lines.push('')

    for (const check of result.results) {
      const status = check.satisfied ? '✓' : (check.required ? '✗ [REQUIRED]' : '○ [optional]')
      lines.push(`  ${status} ${check.title}`)
      if (check.matchedArtifact) {
        lines.push(`    → Matched: ${check.matchedArtifact}`)
      }
      if (check.reason) {
        lines.push(`    → Reason: ${check.reason}`)
      }
    }

    return lines.join('\n')
  }
}
