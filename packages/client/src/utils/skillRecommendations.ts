import type { SkillInfo } from '../types'

// Conservative local matching: role or agent brand alone never triggers a skill.
const domains = [
  { skill: /imagegen|image-generation/i, task: /生成.{0,8}(图片|图像|插画)|图片编辑|文生图|image generation|generate.{0,12}image/i, reason: '任务涉及图片生成或编辑' },
  { skill: /openai-docs/i, task: /openai.{0,12}(api|sdk|文档)|responses api|codex.{0,8}(配置|文档|安装)|chatgpt.{0,8}(接口|文档)/i, reason: '任务涉及 OpenAI 产品或接口文档' },
  { skill: /review-agent|code-review/i, task: /代码审查|代码审核|审查代码|code review|review code|质量验收/i, reason: '任务涉及代码审查或验收' },
  { skill: /skill-creator/i, task: /创建.{0,8}skill|生成.{0,8}skill|编写.{0,8}skill|create.{0,8}skill/i, reason: '任务明确要求编写 Skill' },
  { skill: /skill-installer/i, task: /安装.{0,8}skill|install.{0,8}skill/i, reason: '任务明确要求安装 Skill' },
  { skill: /plugin-creator/i, task: /创建.{0,8}(插件|plugin)|生成.{0,8}(插件|plugin)|create.{0,8}plugin/i, reason: '任务明确要求创建插件' },
]
function containsPhrase(text: string, phrase: string): boolean {
  const normalized = phrase.trim().toLowerCase()
  if (normalized.length < 3) return false
  if (/[\u3400-\u9fff]/.test(normalized)) return text.includes(normalized)
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(text)
}
export function recommendSkills(skills: SkillInfo[], task: { name: string; description?: string; userInput?: string }) {
  const text = `${task.name}\n${task.description || ''}\n${task.userInput || ''}`.toLowerCase()
  return skills.flatMap(skill => {
    if (containsPhrase(text, skill.name)) return [{ skill, reason: '任务明确提到了此 Skill', score: 3 }]
    const trigger = skill.triggers.find(value => containsPhrase(text, value))
    if (trigger) return [{ skill, reason: `匹配触发词：${trigger}`, score: 2 }]
    const domain = domains.find(rule => rule.skill.test(skill.name) && rule.task.test(text))
    return domain ? [{ skill, reason: domain.reason, score: 1 }] : []
  }).sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name)).slice(0, 3)
}
export function createSkillDraft(task: { name: string; description?: string }, projectName?: string) {
  // JSON strings are valid YAML scalars and prevent user text from breaking frontmatter.
  return `---\nname: task-workflow\ndescription: ${JSON.stringify(`用于${task.name}。使用前请补充明确触发条件。`)}\n---\n\n# ${task.name.replace(/[\r\n]/g, ' ')}\n\n## 适用范围\n\n${projectName ? `项目：${projectName.replace(/[\r\n]/g, ' ')}\n\n` : ''}仅用于以下任务；使用前请细化适用条件和不适用场景。\n\n${task.description || task.name}\n\n## 工作步骤（待按项目补充）\n\n1. 阅读相关代码和项目约定，确认输入、目标与影响范围。\n2. 列出具体实施步骤，完成任务要求。\n3. 执行与改动相关的检查，并记录结果和未解决的问题。\n\n## 验收标准（待补充）\n\n- [ ] 明确预期行为及边界情况。\n- [ ] 填写本项目实际可执行的验证命令。\n- [ ] 记录产物位置与交付要求。\n\n> 此文件为本地模板草稿，并非模型生成或已验证的 Skill。请修改 name、触发条件和步骤后再安装。\n`
}
