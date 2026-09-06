import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillStudioService, validateSkillDocument } from '../src/services/skill-studio.js'
import { SkillService } from '../src/services/skill.js'
import { SkillMaterializationService } from '../src/services/skill-materialization.js'
import type { ProjectService } from '../src/services/project.js'
const roots: string[] = []
const document = (name: string) => `---\nname: ${name}\ndescription: Regression checks\ntriggers: [接口回归]\n---\n# Steps\nCheck inputs and outputs.\n`
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'skill-studio-test-')); roots.push(root)
  const projects = { getSkillsDir: (id: string) => id === 'p1' ? root : null,
    scanProjectSkills: async (id: string) => { if (id !== 'p1') throw new Error('Project not found'); return new SkillService().loadSkills([root]) } } as unknown as ProjectService
  return { root, service: new SkillStudioService(projects) }
}
describe('Skill studio publishing', () => {
  it('validates frontmatter and rejects path traversal and malformed triggers', () => {
    expect(validateSkillDocument(document('api-review')).name).toBe('api-review')
    expect(() => validateSkillDocument(document('../escape'))).toThrow()
    expect(() => validateSkillDocument(document('review').replace('[接口回归]', '{run: shell}'))).toThrow()
    expect(() => validateSkillDocument('x'.repeat(65537))).toThrow()
    expect(() => validateSkillDocument('---\nname: abc\n---\nbody')).toThrow()
  })
  it('publishes a discoverable file, reads it by id, and refuses overwrite', async () => {
    const { root, service } = await setup()
    const saved = await service.save('p1', document('api-review'))
    expect(saved.path).toBe(join(root, 'api-review', 'SKILL.md'))
    expect((await service.read('p1', saved.id)).content).toBe(document('api-review'))
    await expect(service.save('p1', document('api-review') + 'overwrite')).rejects.toThrow()
    expect(await readFile(saved.path, 'utf8')).toBe(document('api-review'))
    await expect(service.read('p1', '../../secret')).rejects.toThrow('Skill not found')
    await expect(service.save('missing', document('api-review'))).rejects.toThrow('Project not found')
  })
  it('materializes explicit project snapshots without reusing another project cache', async () => {
    const materializer = new SkillMaterializationService(new SkillService())
    materializer.setWhitelist('node', ['skill_review'])
    const skill = { id: 'skill_review', name: 'review', path: '/unused', description: '', triggers: [], content: 'Project A instructions' }
    expect(await materializer.getSkillPromptForNode('node', [skill])).toContain('Project A instructions')
    const next = await materializer.getSkillPromptForNode('node', [{ ...skill, content: 'Project B instructions' }])
    expect(next).toContain('Project B instructions'); expect(next).not.toContain('Project A instructions')
    materializer.setWhitelist('node', ['other'])
    expect(await materializer.getSkillPromptForNode('node', [skill])).not.toContain('Project A instructions')
  })
})
