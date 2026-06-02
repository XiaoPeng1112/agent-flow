import { Router } from 'express'
import type { FileSystemService } from '../services/filesystem.js'
import type { SkillService } from '../services/skill.js'
import type { SkillMaterializationService } from '../services/skill-materialization.js'

export function createFilesRouter(deps: {
  fileService: FileSystemService
  skillService: SkillService
  skillMaterializationService: SkillMaterializationService
}): Router {
  const router = Router()
  const { fileService, skillService, skillMaterializationService } = deps

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

  return router
}
