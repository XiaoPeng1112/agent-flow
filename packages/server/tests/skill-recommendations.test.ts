import { describe, expect, it } from 'vitest'
import { createSkillDraft, recommendSkills } from '../../client/src/utils/skillRecommendations'
const skill = (name: string, triggers: string[] = []) => ({ id: name, name, description: '', triggers, path: '/tmp/skills/' + name })
const catalog = ['imagegen', 'openai-docs', 'review-agent', 'skill-creator', 'skill-installer', 'plugin-creator'].map(name => skill(name))
describe('node Skill recommendations', () => {
  it('does not force specialized tools into generic coding', () => {
    expect(recommendSkills(catalog, { name: '代码实现', description: '直接编码实现功能，系统优化' })).toEqual([])
  })
  it('matches the task domain and explains the recommendation', () => {
    const result = recommendSkills(catalog, { name: '代码审查', description: '检查本次改动' })
    expect(result.map(item => item.skill.id)).toEqual(['review-agent'])
    expect(result[0].reason).toContain('代码审查')
  })
  it('matches explicit names and installed custom trigger phrases', () => {
    const result = recommendSkills([...catalog, skill('db-check', ['数据库迁移'])], { name: '数据库迁移', description: '用 review-agent 检查' })
    expect(result.map(item => item.skill.id)).toEqual(['review-agent', 'db-check'])
  })
  it('does not treat an English substring as a skill mention', () => {
    expect(recommendSkills([skill('pdf')], { name: '修复 pdfium 构建' })).toEqual([])
  })
  it('matches documentation or image work without selecting creators', () => {
    expect(recommendSkills(catalog, { name: 'OpenAI API 文档更新' }).map(item => item.skill.id)).toEqual(['openai-docs'])
    expect(recommendSkills(catalog, { name: '生成一张图片' }).map(item => item.skill.id)).toEqual(['imagegen'])
  })
  it('creates an editable draft with escaped metadata and no fabricated commands', () => {
    const draft = createSkillDraft({ name: '测试: "模块"\n---', description: '检查分页行为' }, 'Demo')
    expect(draft).toContain('description: "用于测试: \\"模块\\"\\n---。')
    expect(draft).toContain('检查分页行为')
    expect(draft).toContain('本地模板草稿')
    expect(draft).toContain('填写本项目实际可执行的验证命令')
  })
})
