import { Router } from 'express'
import type { FileSystemService } from '../services/filesystem.js'
import type { SkillService } from '../services/skill.js'
import type { SkillMaterializationService } from '../services/skill-materialization.js'
import type { SkillExtractionService } from '../services/skill-extraction.js'
import type { ProjectService } from '../services/project.js'
import type { WorkflowEngine } from '../services/workflow-engine.js'

export function createFilesRouter(deps: {
  fileService: FileSystemService
  skillService: SkillService
  skillMaterializationService: SkillMaterializationService
  skillExtractionService: SkillExtractionService
  projectService: ProjectService
  workflowEngine: WorkflowEngine
}): Router {
  const router = Router()
  const { fileService, skillService, skillMaterializationService, skillExtractionService, projectService, workflowEngine } = deps

  // File API

  router.get('/read', async (req, res) => {
    const { path } = req.query as { path: string }
    if (!path) {
      res.status(400).json({ success: false, error: 'path is required' })
      return
    }
    try {
      const content = await fileService.readFile(path)
      res.json({ success: true, data: { content, path } })
    } catch (err) {
      res.status(404).json({ success: false, error: (err as Error).message })
    }
  })

  router.get('/list', async (req, res) => {
    const { path } = req.query as { path: string }
    if (!path) {
      res.status(400).json({ success: false, error: 'path is required' })
      return
    }
    try {
      const entries = await fileService.listDir(path)
      res.json({ success: true, data: { entries, path } })
    } catch (err) {
      res.status(404).json({ success: false, error: (err as Error).message })
    }
  })

  router.post('/write', async (req, res) => {
    const { path, content } = req.body as { path: string; content: string }
    if (!path || content === undefined) {
      res.status(400).json({ success: false, error: 'path and content are required' })
      return
    }
    try {
      await fileService.writeFile(path, content)
      res.json({ success: true, data: { path } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  // Skill API

  router.get('/skills', (_req, res) => {
    res.json({ success: true, data: { skills: skillService.getSkills() } })
  })

  router.post('/skills/reload', async (req, res) => {
    const { paths } = req.body as { paths?: string[] }
    const searchPaths = paths || [
      `${process.env.HOME}/.catpaw/skills`,
      `${process.env.HOME}/.claude/skills`,
      `${process.env.HOME}/.codex/skills`,
      `${process.cwd()}/.catpaw/skills`,
      `${process.cwd()}/.claude/skills`,
      `${process.cwd()}/.codex/skills`,
    ]
    const skills = await skillService.loadSkills(searchPaths)
    res.json({ success: true, data: { skills, count: skills.length } })
  })

  /** 根据节点描述智能推荐 Skills */
  router.post('/skills/recommend', (req, res) => {
    const { description, nodeType } = req.body as { description: string; nodeType?: string }
    if (!description) {
      res.status(400).json({ success: false, error: 'description is required' })
      return
    }
    const allSkills = skillService.getSkills()
    const recommendations = allSkills
      .map(skill => {
        let score = 0
        const descLower = description.toLowerCase()
        const skillDesc = (skill.description + ' ' + skill.triggers.join(' ')).toLowerCase()

        for (const trigger of skill.triggers) {
          if (descLower.includes(trigger.toLowerCase())) score += 10
        }
        const descWords = descLower.split(/\s+/)
        for (const word of descWords) {
          if (word.length > 2 && skillDesc.includes(word)) score += 1
        }
        if (nodeType && skill.triggers.some(t => t.includes(nodeType))) score += 5

        return { skill, score }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(r => ({ ...r.skill, relevanceScore: r.score }))

    res.json({ success: true, data: { recommendations } })
  })

  // Skill Materialization API

  /** 获取节点的物化 Skill */
  router.get('/skills/materialize/:nodeId', async (req, res) => {
    try {
      const skills = await skillMaterializationService.materializeForNode(req.params.nodeId)
      const prompt = skillMaterializationService.formatSkillsAsPrompt(skills)
      res.json({ success: true, data: { skills, prompt } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 设置节点的 Skill 白名单 */
  router.post('/skills/whitelist/:nodeId', (req, res) => {
    const { allowedSkillIds, denySkillIds } = req.body
    skillMaterializationService.setWhitelist(req.params.nodeId, allowedSkillIds || [], denySkillIds)
    res.json({ success: true })
  })

  /** 获取节点的 Skill 白名单 */
  router.get('/skills/whitelist/:nodeId', (req, res) => {
    const whitelist = skillMaterializationService.getWhitelist(req.params.nodeId)
    res.json({ success: true, data: { whitelist } })
  })

  /** 获取物化统计 */
  router.get('/skills/materialization-stats', (_req, res) => {
    const stats = skillMaterializationService.getStats()
    res.json({ success: true, data: stats })
  })

  // ═══════════════ Skill 沉淀 API ═══════════════

  /** 获取沉淀统计 */
  router.get('/skills/extraction-stats', (_req, res) => {
    const stats = skillExtractionService.getStats()
    res.json({ success: true, data: stats })
  })

  /** 获取沉淀日志 */
  router.get('/skills/extraction-log', (req, res) => {
    const { runId } = req.query as { runId?: string }
    const log = skillExtractionService.getExtractionLog(runId)
    res.json({ success: true, data: { log } })
  })

  /** 手动触发沉淀：将指定节点产出物强制沉淀为 Skill */
  router.post('/skills/extract', async (req, res) => {
    const { runId, nodeId, content, name } = req.body as {
      runId: string
      nodeId: string
      content?: string
      name?: string
    }
    if (!runId || !nodeId) {
      res.status(400).json({ success: false, error: 'runId and nodeId are required' })
      return
    }

    try {
      const run = workflowEngine.getRun(runId)
      if (!run) {
        res.status(404).json({ success: false, error: 'Run not found' })
        return
      }
      const node = run.nodes.find(n => n.id === nodeId)
      if (!node) {
        res.status(404).json({ success: false, error: 'Node not found' })
        return
      }

      if (content && name) {
        // 手动沉淀指定内容
        const skill = await skillExtractionService.forceExtract(content, name, run.projectId, {
          runId, nodeId, nodeName: node.name, nodeType: node.type,
        })
        // 重新加载
        const skillsDir = projectService.getSkillsDir(run.projectId)
        if (skillsDir) await skillService.loadAdditional([skillsDir])
        res.json({ success: true, data: { skill } })
      } else {
        // 自动分析沉淀
        const extracted = await skillExtractionService.extractFromNode(node, run)
        if (extracted.length > 0) {
          const skillsDir = projectService.getSkillsDir(run.projectId)
          if (skillsDir) await skillService.loadAdditional([skillsDir])
        }
        res.json({ success: true, data: { extracted, count: extracted.length } })
      }
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  /** 获取项目的沉淀 Skills 目录信息 */
  router.get('/skills/project-dir/:projectId', (req, res) => {
    const dir = projectService.getSkillsDir(req.params.projectId)
    res.json({ success: true, data: { dir } })
  })

  // ─── 通配参数路由放最后，避免拦截上面的具名路由 ───
  router.get('/skills/:name', async (req, res) => {
    const skill = skillService.getSkill(req.params.name)
    if (!skill) {
      res.status(404).json({ success: false, error: 'Skill not found' })
      return
    }
    try {
      const content = await skillService.readSkillContent(skill.path)
      res.json({ success: true, data: { ...skill, content } })
    } catch (err) {
      res.status(500).json({ success: false, error: (err as Error).message })
    }
  })

  return router
}
