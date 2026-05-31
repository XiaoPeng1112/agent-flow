import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises'
import { join } from 'path'
import type { ContextLayer } from '../types/index.js'

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

  constructor() {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.basePath = join(home, '.agent-flow', 'context-db')
  }

  /**
   * 初始化目录结构
   */
  async initialize(): Promise<void> {
    await mkdir(join(this.basePath, 'SYS'), { recursive: true })
    await mkdir(join(this.basePath, 'L0'), { recursive: true })
    await mkdir(join(this.basePath, 'L1'), { recursive: true })
    await mkdir(join(this.basePath, 'L2'), { recursive: true })
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
    const dir = level === 'SYS'
      ? join(this.basePath, 'SYS')
      : join(this.basePath, level, scopeId)
    
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, filename)
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
    try {
      const dir = level === 'SYS'
        ? join(this.basePath, 'SYS')
        : join(this.basePath, level, scopeId)
      const content = await readFile(join(dir, filename), 'utf-8')
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
    try {
      const dir = level === 'SYS'
        ? join(this.basePath, 'SYS')
        : join(this.basePath, level, scopeId)
      
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
   * 删除上下文文件
   */
  async deleteContext(
    level: ContextLayer['level'],
    scopeId: string,
    filename: string
  ): Promise<boolean> {
    try {
      const dir = level === 'SYS'
        ? join(this.basePath, 'SYS')
        : join(this.basePath, level, scopeId)
      await unlink(join(dir, filename))
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
