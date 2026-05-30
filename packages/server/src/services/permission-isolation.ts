import { randomUUID } from 'crypto'
import type {
  AgentPermissionPolicy, RepoAccessRule, FileAccessRule,
  RepoPermission, AuditLogEntry,
} from '../types/index.js'

/**
 * PermissionIsolationService — 权限隔离服务
 * 
 * 核心职责：
 * 1. Agent 权限策略管理：定义每个 Agent 可访问的仓库和文件范围
 * 2. 访问检查：在 Agent 操作文件前验证权限
 * 3. 最小权限原则：默认拒绝，显式授权
 * 4. 审计追踪：记录所有权限检查和违规行为
 * 
 * 安全模型：
 * - 三级权限：none → read → read-write
 * - 仓库级 + 文件级（glob 模式）双层控制
 * - 黑名单路径（deniedPaths）优先级最高
 * - 权限继承：Agent 配置 > 节点配置 > Run 默认配置
 */
export class PermissionIsolationService {
  private policies: Map<string, AgentPermissionPolicy> = new Map()  // `${agentId}:${runId}` → policy
  private auditLog: AuditLogEntry[] = []
  private maxAuditEntries = 10000

  // ═══════════════ 策略管理 ═══════════════

  /**
   * 设置 Agent 权限策略
   */
  setPolicy(policy: AgentPermissionPolicy): void {
    const key = `${policy.agentId}:${policy.runId}`
    this.policies.set(key, policy)
  }

  /**
   * 获取 Agent 权限策略
   */
  getPolicy(agentId: string, runId: string): AgentPermissionPolicy | undefined {
    return this.policies.get(`${agentId}:${runId}`)
  }

  /**
   * 为 Agent 在 Run 中批量设置仓库权限
   */
  grantRepoAccess(agentId: string, runId: string, rules: RepoAccessRule[]): void {
    const key = `${agentId}:${runId}`
    let policy = this.policies.get(key)
    if (!policy) {
      policy = { agentId, runId, repoAccess: [] }
      this.policies.set(key, policy)
    }
    
    for (const rule of rules) {
      // 更新或新增
      const existing = policy.repoAccess.findIndex(r => r.repoId === rule.repoId)
      if (existing >= 0) {
        policy.repoAccess[existing] = rule
      } else {
        policy.repoAccess.push(rule)
      }
    }
  }

  /**
   * 设置文件级权限规则
   */
  setFileRules(agentId: string, runId: string, rules: FileAccessRule[]): void {
    const key = `${agentId}:${runId}`
    let policy = this.policies.get(key)
    if (!policy) {
      policy = { agentId, runId, repoAccess: [] }
      this.policies.set(key, policy)
    }
    policy.filePatterns = rules
  }

  /**
   * 快捷方法：创建只读策略
   */
  createReadOnlyPolicy(agentId: string, runId: string, repoIds: string[]): void {
    this.setPolicy({
      agentId,
      runId,
      repoAccess: repoIds.map(repoId => ({
        repoId,
        permission: 'read' as RepoPermission,
      })),
    })
  }

  /**
   * 快捷方法：创建完全访问策略
   */
  createFullAccessPolicy(agentId: string, runId: string, repoIds: string[]): void {
    this.setPolicy({
      agentId,
      runId,
      repoAccess: repoIds.map(repoId => ({
        repoId,
        permission: 'read-write' as RepoPermission,
      })),
    })
  }

  // ═══════════════ 权限检查 ═══════════════

  /**
   * 检查 Agent 对仓库的访问权限
   * 
   * @returns 是否允许访问
   */
  checkRepoAccess(
    agentId: string,
    runId: string,
    repoId: string,
    requiredPermission: RepoPermission
  ): { allowed: boolean; reason?: string } {
    const policy = this.getPolicy(agentId, runId)

    // 无策略 → 默认允许（向后兼容，未配置权限的 Run 不受限）
    if (!policy) {
      return { allowed: true, reason: 'No policy configured (permissive mode)' }
    }

    const repoRule = policy.repoAccess.find(r => r.repoId === repoId)
    if (!repoRule) {
      // 仓库未在策略中声明 → 拒绝
      this.audit(runId, agentId, 'repo_access_denied', {
        repoId, requiredPermission, reason: 'Repo not in policy',
      })
      return { allowed: false, reason: `Agent "${agentId}" has no access to repo "${repoId}"` }
    }

    // 权限等级比较：none < read < read-write
    const permissionLevel = { 'none': 0, 'read': 1, 'read-write': 2 }
    const granted = permissionLevel[repoRule.permission] || 0
    const required = permissionLevel[requiredPermission] || 0

    if (granted < required) {
      this.audit(runId, agentId, 'repo_access_denied', {
        repoId, requiredPermission, grantedPermission: repoRule.permission,
      })
      return {
        allowed: false,
        reason: `Insufficient permission: has "${repoRule.permission}", needs "${requiredPermission}"`,
      }
    }

    return { allowed: true }
  }

  /**
   * 检查 Agent 对文件路径的访问权限
   * 
   * 检查顺序：
   * 1. 仓库级 deniedPaths（绝对拒绝）
   * 2. 仓库级 allowedPaths（白名单模式）
   * 3. 文件级 glob 模式匹配
   */
  checkFileAccess(
    agentId: string,
    runId: string,
    repoId: string,
    filePath: string,
    requiredPermission: 'read' | 'write'
  ): { allowed: boolean; reason?: string } {
    const policy = this.getPolicy(agentId, runId)
    if (!policy) return { allowed: true }

    const repoRule = policy.repoAccess.find(r => r.repoId === repoId)
    if (!repoRule) {
      return { allowed: false, reason: `No access to repo "${repoId}"` }
    }

    // 检查 deniedPaths（绝对黑名单）
    if (repoRule.deniedPaths) {
      for (const denied of repoRule.deniedPaths) {
        if (filePath.startsWith(denied) || this.globMatch(filePath, denied)) {
          this.audit(runId, agentId, 'file_access_denied', {
            repoId, filePath, reason: `Path in deniedPaths: ${denied}`,
          })
          return { allowed: false, reason: `Path "${filePath}" is in denied list` }
        }
      }
    }

    // 检查 allowedPaths（白名单模式，如果配置了则只允许白名单路径）
    if (repoRule.allowedPaths && repoRule.allowedPaths.length > 0) {
      const inWhitelist = repoRule.allowedPaths.some(
        allowed => filePath.startsWith(allowed) || this.globMatch(filePath, allowed)
      )
      if (!inWhitelist) {
        this.audit(runId, agentId, 'file_access_denied', {
          repoId, filePath, reason: 'Path not in allowedPaths',
        })
        return { allowed: false, reason: `Path "${filePath}" is not in allowed directories` }
      }
    }

    // 文件级 glob 规则
    if (policy.filePatterns) {
      for (const rule of policy.filePatterns) {
        if (this.globMatch(filePath, rule.pattern)) {
          if (rule.permission === 'none') {
            return { allowed: false, reason: `File pattern "${rule.pattern}" denies access` }
          }
          if (requiredPermission === 'write' && rule.permission === 'read') {
            return { allowed: false, reason: `File pattern "${rule.pattern}" only allows read` }
          }
        }
      }
    }

    return { allowed: true }
  }

  /**
   * 综合权限检查：仓库 + 文件路径
   */
  checkAccess(params: {
    agentId: string
    runId: string
    repoId: string
    filePath?: string
    requiredPermission: RepoPermission
  }): { allowed: boolean; reason?: string } {
    const { agentId, runId, repoId, filePath, requiredPermission } = params

    // Step 1: 仓库级检查
    const repoCheck = this.checkRepoAccess(agentId, runId, repoId, requiredPermission)
    if (!repoCheck.allowed) return repoCheck

    // Step 2: 文件级检查（如果提供了文件路径）
    if (filePath && requiredPermission !== 'none') {
      const filePermission = requiredPermission === 'read-write' ? 'write' : 'read'
      return this.checkFileAccess(agentId, runId, repoId, filePath, filePermission)
    }

    return { allowed: true }
  }

  // ═══════════════ 审计日志 ═══════════════

  /**
   * 记录审计日志
   */
  private audit(
    runId: string,
    agentId: string,
    action: string,
    details: Record<string, unknown>
  ): void {
    const entry: AuditLogEntry = {
      id: `audit_${randomUUID().slice(0, 8)}`,
      runId,
      agentId,
      action,
      details,
      timestamp: Date.now(),
      level: action.includes('denied') ? 'warn' : 'info',
    }

    this.auditLog.push(entry)

    // 控制日志数量
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-Math.floor(this.maxAuditEntries * 0.8))
    }

    // 同时 console 输出警告级别日志
    if (entry.level === 'warn') {
      console.warn(`[Permission] ${action}: agent=${agentId} run=${runId}`, details)
    }
  }

  /**
   * 获取审计日志
   */
  getAuditLog(filters?: {
    runId?: string
    agentId?: string
    level?: 'info' | 'warn' | 'error'
    limit?: number
  }): AuditLogEntry[] {
    let log = this.auditLog

    if (filters?.runId) log = log.filter(e => e.runId === filters.runId)
    if (filters?.agentId) log = log.filter(e => e.agentId === filters.agentId)
    if (filters?.level) log = log.filter(e => e.level === filters.level)

    const limit = filters?.limit || 100
    return log.slice(-limit)
  }

  /**
   * 清除 Run 相关的策略和审计日志
   */
  cleanupRun(runId: string): void {
    for (const [key, policy] of this.policies) {
      if (policy.runId === runId) {
        this.policies.delete(key)
      }
    }
    this.auditLog = this.auditLog.filter(e => e.runId !== runId)
  }

  // ═══════════════ 内部工具 ═══════════════

  /**
   * 简化的 Glob 匹配
   * 支持 * 和 ** 通配符
   */
  private globMatch(path: string, pattern: string): boolean {
    // 将 glob 转为正则
    const regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{GLOBSTAR\}\}/g, '.*')

    try {
      const regex = new RegExp(`^${regexStr}$`)
      return regex.test(path)
    } catch {
      return false
    }
  }
}
