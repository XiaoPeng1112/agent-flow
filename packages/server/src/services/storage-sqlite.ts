import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import type { RunTombstone } from './sync-record.js'
import type {
  Run, TaskNode, DAGEdge, AgentTurn,
  Artifact, InboxItem,
} from '../types/index.js'

/**
 * StorageSQLite — SQLite + WAL 持久化层
 *
 * 设计要点：
 * - 单个 .db 文件，无额外服务进程
 * - WAL 模式：读写不互斥，崩溃安全
 * - 同步 API（better-sqlite3 特性）：与现有代码完美契合
 * - 表结构正规化：runs / nodes / edges / turns / artifacts / inbox
 * - 事务保障：批量写入使用 transaction
 * - 自动创建表（首次启动）
 *
 * 数据模型映射：
 *   Run → runs 表（核心字段平铺）+ nodes/edges 子表
 *   AgentTurn → turns 表
 *   Artifact → artifacts 表
 *   InboxItem → inbox 表
 */
export class StorageSQLite {
  private db: Database.Database

  constructor(dbPath?: string) {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    const finalPath = dbPath || join(home, '.agent-flow', 'data', 'agent-flow.db')

    // :memory: 模式不需要创建目录
    if (finalPath !== ':memory:') {
      const dir = dirname(finalPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }

    this.db = new Database(finalPath)

    // 开启 WAL 模式
    this.db.pragma('journal_mode = WAL')
    // 性能优化
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('cache_size = -64000')  // 64MB cache
    this.db.pragma('temp_store = MEMORY')
    // 关闭外键约束检查 — 数据完整性由应用层保证，避免 orphan turn 等历史数据触发约束错误
    this.db.pragma('foreign_keys = OFF')

    try {
      this.initSchema()
      this.migrateSchema()
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  // ═══════════════ Schema 初始化 ═══════════════

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS run_tombstones (run_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        config_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        agent_role TEXT,
        skill_ids_json TEXT,
        prompt TEXT,
        "order" INTEGER NOT NULL DEFAULT 0,
        execution_mode TEXT,
        script TEXT,
        script_cwd TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT,
        user_input TEXT,
        context_json TEXT,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_run ON nodes(run_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);

      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        condition_json TEXT,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_edges_run ON edges(run_id);

      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running',
        result TEXT,
        prompt TEXT,
        output TEXT DEFAULT '',
        question TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        token_input INTEGER,
        token_output INTEGER,
        token_total INTEGER,
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_turns_node ON turns(node_id);
      CREATE INDEX IF NOT EXISTS idx_turns_run ON turns(run_id);

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        format TEXT,
        content TEXT,
        file_path TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_artifacts_node ON artifacts(node_id);

      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        run_id TEXT,
        node_id TEXT,
        type TEXT NOT NULL,
        payload_json TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_inbox_agent ON inbox(agent_id);
      CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox(status);

      -- 版本跟踪（用于将来 schema 迁移）
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `)

    // 记录当前 schema 版本
    const currentVersion = this.db.prepare(
      'SELECT MAX(version) as v FROM schema_version'
    ).get() as { v: number | null } | undefined

    if (!currentVersion || currentVersion.v === null) {
      this.db.prepare(
        'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)'
      ).run(1, Date.now())
    }
  }

  private migrateSchema(): void {
    const version = (this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version: number }).version
    if (version >= 2) return
    // VACUUM INTO includes committed WAL data, unlike copying only the database file.
    const hasData = (this.db.prepare('SELECT COUNT(*) AS count FROM runs').get() as { count: number }).count > 0
    if (hasData && this.db.name !== ':memory:') {
      this.db.prepare('VACUUM INTO ?').run(`${this.db.name}.pre-v2-${Date.now()}.bak`)
    }
    this.db.transaction(() => {
      for (const table of ['runs', 'nodes', 'turns']) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN metadata_json TEXT`)
      }
      this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(2, Date.now())
    })()
  }

  // ═══════════════ Run CRUD ═══════════════

  saveRun(run: Run): void {
    const upsertRun = this.db.prepare(`
      INSERT OR REPLACE INTO runs (id, project_id, template_id, name, status, created_at, started_at, completed_at, config_json, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const upsertNode = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (id, run_id, name, type, description, status, agent_role, skill_ids_json, prompt, "order", execution_mode, script, script_cwd, started_at, completed_at, error, user_input, context_json, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const deleteEdges = this.db.prepare('DELETE FROM edges WHERE run_id = ?')
    const insertEdge = this.db.prepare(`
      INSERT INTO edges (run_id, source, target, condition_json)
      VALUES (?, ?, ?, ?)
    `)

    const upsertArtifact = this.db.prepare(`
      INSERT OR REPLACE INTO artifacts (id, node_id, title, category, format, content, file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const deleteArtifacts = this.db.prepare('DELETE FROM artifacts WHERE node_id = ?')

    const transaction = this.db.transaction(() => {
      upsertRun.run(
        run.id,
        run.projectId,
        run.templateId,
        run.name,
        run.status,
        run.createdAt,
        run.startedAt || null,
        run.completedAt || null,
        run.config ? JSON.stringify(run.config) : null,
        JSON.stringify({ description: run.description })
      )

      for (const node of run.nodes) {
        upsertNode.run(
          node.id,
          run.id,
          node.name,
          node.type,
          node.description ?? null,
          node.status,
          node.agentRole || null,
          node.skillIds ? JSON.stringify(node.skillIds) : null,
          node.prompt || null,
          node.order,
          node.executionMode || null,
          node.script || null,
          node.scriptCwd || null,
          node.startedAt || null,
          node.completedAt || null,
          node.error || null,
          node.userInput || null,
          node.context ? JSON.stringify(node.context) : null,
          JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key]) => ![
            'id', 'runId', 'name', 'type', 'description', 'status', 'agentRole', 'skillIds',
            'prompt', 'order', 'executionMode', 'script', 'scriptCwd', 'startedAt',
            'completedAt', 'error', 'userInput', 'context', 'artifacts',
          ].includes(key))))
        )

        // 保存节点的 artifacts
        deleteArtifacts.run(node.id)
        for (const art of node.artifacts) {
          upsertArtifact.run(
            art.id,
            art.nodeId,
            art.title,
            art.category,
            art.format || null,
            art.content || null,
            art.filePath || null,
            art.createdAt
          )
        }
      }

      // 边：先删后插（边没有稳定 ID）
      deleteEdges.run(run.id)
      for (const edge of run.edges) {
        insertEdge.run(
          run.id,
          edge.source,
          edge.target,
          edge.condition ? JSON.stringify(edge.condition) : null
        )
      }
    })

    transaction()
  }

  getRun(runId: string): Run | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as any
    if (!row) return undefined
    return this.assembleRun(row)
  }

  getAllRuns(projectId?: string): Run[] {
    let rows: any[]
    if (projectId) {
      rows = this.db.prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as any[]
    } else {
      rows = this.db.prepare('SELECT * FROM runs ORDER BY created_at DESC').all() as any[]
    }
    return rows.map(row => this.assembleRun(row))
  }

  deleteRun(runId: string, tombstone?: RunTombstone): boolean {
    const deleteArtifacts = this.db.prepare(`
      DELETE FROM artifacts
      WHERE node_id IN (SELECT id FROM nodes WHERE run_id = ?)
    `)
    const deleteTurns = this.db.prepare('DELETE FROM turns WHERE run_id = ?')
    const deleteEdges = this.db.prepare('DELETE FROM edges WHERE run_id = ?')
    const deleteNodes = this.db.prepare('DELETE FROM nodes WHERE run_id = ?')
    const deleteRun = this.db.prepare('DELETE FROM runs WHERE id = ?')

    const transaction = this.db.transaction(() => {
      if (tombstone) this.db.prepare('INSERT OR REPLACE INTO run_tombstones (run_id, payload_json) VALUES (?, ?)').run(runId, JSON.stringify(tombstone))
      deleteArtifacts.run(runId)
      deleteTurns.run(runId)
      deleteEdges.run(runId)
      deleteNodes.run(runId)
      return deleteRun.run(runId)
    })

    const result = transaction()
    return result.changes > 0
  }

  getRunTombstones(): RunTombstone[] {
    return (this.db.prepare('SELECT payload_json FROM run_tombstones').all() as Array<{ payload_json: string }>).map(row => JSON.parse(row.payload_json))
  }

  replaceRun(run: Run, turns: Record<string, AgentTurn[]>): void {
    this.db.transaction(() => {
      this.deleteRun(run.id)
      this.saveRun(run)
      this.saveTurns(Object.values(turns).flat())
    })()
  }

  private assembleRun(row: any): Run {
    const nodes = this.getNodes(row.id)
    const edges = this.getEdges(row.id)

    return {
      ...JSON.parse(row.metadata_json || '{}'),
      id: row.id,
      projectId: row.project_id,
      templateId: row.template_id,
      name: row.name,
      status: row.status,
      nodes,
      edges,
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      config: row.config_json ? JSON.parse(row.config_json) : undefined,
    }
  }

  private getNodes(runId: string): TaskNode[] {
    const rows = this.db.prepare(
      'SELECT * FROM nodes WHERE run_id = ? ORDER BY "order"'
    ).all(runId) as any[]

    return rows.map(row => {
      const artifacts = this.getArtifacts(row.id)
      return {
        ...JSON.parse(row.metadata_json || '{"requiresContractReview":true}'),
        id: row.id,
        runId: row.run_id,
        name: row.name,
        type: row.type,
        description: row.description ?? '',
        status: row.status,
        agentRole: row.agent_role || undefined,
        skillIds: row.skill_ids_json ? JSON.parse(row.skill_ids_json) : undefined,
        artifacts,
        prompt: row.prompt || undefined,
        order: row.order,
        executionMode: row.execution_mode || undefined,
        script: row.script || undefined,
        scriptCwd: row.script_cwd || undefined,
        startedAt: row.started_at || undefined,
        completedAt: row.completed_at || undefined,
        error: row.error || undefined,
        userInput: row.user_input || undefined,
        context: row.context_json ? JSON.parse(row.context_json) : undefined,
      } as TaskNode
    })
  }

  private getEdges(runId: string): DAGEdge[] {
    const rows = this.db.prepare(
      'SELECT * FROM edges WHERE run_id = ?'
    ).all(runId) as any[]

    return rows.map(row => ({
      source: row.source,
      target: row.target,
      condition: row.condition_json ? JSON.parse(row.condition_json) : undefined,
    }))
  }

  private getArtifacts(nodeId: string): Artifact[] {
    const rows = this.db.prepare(
      'SELECT * FROM artifacts WHERE node_id = ? ORDER BY created_at'
    ).all(nodeId) as any[]

    return rows.map(row => ({
      id: row.id,
      nodeId: row.node_id,
      title: row.title,
      category: row.category,
      format: row.format || undefined,
      content: row.content || undefined,
      filePath: row.file_path || undefined,
      createdAt: row.created_at,
    }))
  }

  // ═══════════════ Turn CRUD ═══════════════

  saveTurn(turn: AgentTurn): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO turns (id, node_id, run_id, agent_id, turn_index, status, result, prompt, output, question, started_at, completed_at, token_input, token_output, token_total, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      turn.id,
      turn.nodeId,
      turn.runId,
      turn.agentId,
      turn.turnIndex,
      turn.status,
      turn.result || null,
      turn.prompt,
      turn.output,
      turn.question || null,
      turn.startedAt,
      turn.completedAt || null,
      turn.tokenUsage?.input ?? null,
      turn.tokenUsage?.output ?? null,
      turn.tokenUsage?.total ?? null,
      JSON.stringify({ toolCalls: turn.toolCalls, filesModified: turn.filesModified, providerExecution: turn.providerExecution }),
    )
  }

  saveTurns(turns: AgentTurn[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO turns (id, node_id, run_id, agent_id, turn_index, status, result, prompt, output, question, started_at, completed_at, token_input, token_output, token_total, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const transaction = this.db.transaction(() => {
      for (const turn of turns) {
        stmt.run(
          turn.id, turn.nodeId, turn.runId, turn.agentId,
          turn.turnIndex, turn.status, turn.result || null,
          turn.prompt, turn.output, turn.question || null,
          turn.startedAt, turn.completedAt || null,
          turn.tokenUsage?.input ?? null,
          turn.tokenUsage?.output ?? null,
          turn.tokenUsage?.total ?? null,
      JSON.stringify({ toolCalls: turn.toolCalls, filesModified: turn.filesModified, providerExecution: turn.providerExecution }),
        )
      }
    })
    transaction()
  }

  getTurnsByNode(nodeId: string): AgentTurn[] {
    const rows = this.db.prepare(
      'SELECT * FROM turns WHERE node_id = ? ORDER BY turn_index'
    ).all(nodeId) as any[]
    return rows.map(this.rowToTurn)
  }

  getTurnsByRun(runId: string): Record<string, AgentTurn[]> {
    const rows = this.db.prepare(
      'SELECT * FROM turns WHERE run_id = ? ORDER BY turn_index'
    ).all(runId) as any[]

    const result: Record<string, AgentTurn[]> = {}
    for (const row of rows) {
      const turn = this.rowToTurn(row)
      if (!result[turn.nodeId]) result[turn.nodeId] = []
      result[turn.nodeId].push(turn)
    }
    return result
  }

  getAllTurns(): Map<string, AgentTurn[]> {
    const rows = this.db.prepare(
      'SELECT * FROM turns ORDER BY turn_index'
    ).all() as any[]

    const map = new Map<string, AgentTurn[]>()
    for (const row of rows) {
      const turn = this.rowToTurn(row)
      const existing = map.get(turn.nodeId) || []
      existing.push(turn)
      map.set(turn.nodeId, existing)
    }
    return map
  }

  private rowToTurn(row: any): AgentTurn {
    return {
      ...JSON.parse(row.metadata_json || '{}'),
      id: row.id,
      nodeId: row.node_id,
      runId: row.run_id,
      agentId: row.agent_id,
      turnIndex: row.turn_index,
      status: row.status,
      result: row.result || undefined,
      prompt: row.prompt,
      output: row.output || '',
      question: row.question || undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      tokenUsage: row.token_total != null ? {
        input: row.token_input || 0,
        output: row.token_output || 0,
        total: row.token_total,
      } : undefined,
    }
  }

  // ═══════════════ Inbox CRUD ═══════════════

  saveInboxItem(item: InboxItem): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO inbox (id, agent_id, run_id, node_id, type, payload_json, status, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id,
      item.agentId,
      item.runId || null,
      item.nodeId || null,
      item.type,
      item.payload ? JSON.stringify(item.payload) : null,
      item.status,
      item.createdAt,
      item.resolvedAt || null
    )
  }

  getInbox(agentId: string): InboxItem[] {
    const rows = this.db.prepare(
      'SELECT * FROM inbox WHERE agent_id = ? ORDER BY created_at'
    ).all(agentId) as any[]

    return rows.map(row => ({
      id: row.id,
      agentId: row.agent_id,
      runId: row.run_id || undefined,
      nodeId: row.node_id || undefined,
      type: row.type,
      payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at || undefined,
    }))
  }

  // ═══════════════ 批量持久化（兼容旧接口） ═══════════════

  /**
   * 全量保存所有 Runs + Turns
   * 用于兼容旧 persist() 调用方式
   */
  saveAll(runs: Run[], turnsMap: Map<string, AgentTurn[]>): void {
    const transaction = this.db.transaction(() => {
      for (const run of runs) {
        this.saveRun(run)
      }
      for (const [_nodeId, turns] of turnsMap) {
        this.saveTurns(turns)
      }
    })
    transaction()
  }

  // ═══════════════ 迁移：从 JSON 导入 ═══════════════

  /**
   * 从旧版 JSON 文件迁移数据到 SQLite
   * 读取 ~/.agent-flow/runs/index.json 并导入
   */
  async migrateFromJson(jsonPath?: string): Promise<{ runs: number; turns: number }> {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    const path = jsonPath || join(home, '.agent-flow', 'runs', 'index.json')

    let raw: string
    try {
      raw = await readFile(path, 'utf-8')
    } catch {
      return { runs: 0, turns: 0 }
    }

    const data = JSON.parse(raw) as { runs: Run[]; turns: Record<string, AgentTurn[]> }

    let runCount = 0
    let turnCount = 0

    // 关闭外键约束，避免旧数据中存在孤儿 Turn（引用已删除的 Node）导致写入失败
    this.db.pragma('foreign_keys = OFF')

    const transaction = this.db.transaction(() => {
      for (const run of data.runs || []) {
        this.saveRun(run)
        runCount++
      }
      if (data.turns) {
        for (const [_nodeId, turns] of Object.entries(data.turns)) {
          this.saveTurns(turns)
          turnCount += turns.length
        }
      }
    })
    transaction()

    // 注意：不恢复 foreign_keys = ON，避免后续 saveAll 中 orphan turn 触发约束错误
    // 数据完整性由应用层（RunManager + TurnManager）保证

    return { runs: runCount, turns: turnCount }
  }

  // ═══════════════ 生命周期 ═══════════════

  close(): void {
    this.db.close()
  }

  /**
   * 获取数据库统计（用于调试）
   */
  getStats(): { runs: number; nodes: number; turns: number; artifacts: number; dbSizeKB: number } {
    const runs = (this.db.prepare('SELECT COUNT(*) as c FROM runs').get() as any).c
    const nodes = (this.db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c
    const turns = (this.db.prepare('SELECT COUNT(*) as c FROM turns').get() as any).c
    const artifacts = (this.db.prepare('SELECT COUNT(*) as c FROM artifacts').get() as any).c

    // 获取 DB 大小
    const pageCount = (this.db.pragma('page_count') as any[])[0]?.page_count || 0
    const pageSize = (this.db.pragma('page_size') as any[])[0]?.page_size || 4096
    const dbSizeKB = Math.round((pageCount * pageSize) / 1024)

    return { runs, nodes, turns, artifacts, dbSizeKB }
  }
}
