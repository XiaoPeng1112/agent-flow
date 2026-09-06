import { SkillStudioDialog } from './SkillStudioDialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App, Button, Select, Spin, Tag } from 'antd'
import { nodeApi, projectApi } from '../../api'
import { useAppStore } from '../../store/appStore'
import type { SkillInfo, TaskNode } from '../../types'
import { createSkillDraft, recommendSkills } from '../../utils/skillRecommendations'

export function NodeSkillBinding({ runId, node, projectId, onUpdate }: {
  runId: string; node: TaskNode; projectId: string; onUpdate: (node: TaskNode) => void
}) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(node.skillIds || [])
  const [draft, setDraft] = useState<string | null>(null)
  const projectName = useAppStore(s => s.projects.find(p => p.id === projectId)?.name)
  const { message } = App.useApp()
  const active = useRef(true)
  const savingRef = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setSkills([])
    projectApi.getSkills(projectId).then(res => {
      if (!cancelled) setSkills(res.skills || [])
    }).catch(err => { if (!cancelled) setError((err as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, retry])
  useEffect(() => { setSelectedIds(node.skillIds || []) }, [node.skillIds])
  const recommendations = useMemo(() => recommendSkills(skills, node), [skills, node])
  const additions = recommendations.filter(item => !selectedIds.includes(item.skill.id))
  const handleChange = async (newIds: string[]) => {
    if (savingRef.current) return
    savingRef.current = true; setSaving(true)
    try {
      const res = await nodeApi.updateSkills(runId, node.id, newIds)
      if (active.current) { setSelectedIds(res.node.skillIds || []); onUpdate(res.node) }
    } catch (err) { if (active.current) message.error(`保存失败：${(err as Error).message}`) }
    finally { savingRef.current = false; if (active.current) setSaving(false) }
  }
  return <section className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3">
    <div className="flex items-center justify-between gap-2 mb-2">
      <span className="text-sm font-medium text-gray-800">节点 Skills</span>
      <div className="flex items-center gap-2"><span className="text-xs text-gray-400">已绑定 {selectedIds.length} 个</span><Button type="text" size="small" disabled={loading || saving} onClick={() => setRetry(n => n + 1)}>刷新</Button></div>
    </div>
    <p className="text-xs text-gray-500 mb-3">根据任务内容和已安装 Skill 的名称、触发词匹配；采用后用于此节点执行。</p>
    {loading ? <Spin size="small" /> : error ? <Alert type="warning" title="无法加载 Skills" description={error} action={<Button size="small" onClick={() => setRetry(n => n + 1)}>重试</Button>} /> : <>
      {recommendations.length > 0 ? <div className="mb-3 rounded-lg bg-white p-3">
        <div className="flex justify-between items-center gap-2 mb-2"><span className="text-xs font-medium text-indigo-600">建议绑定</span>
          <Button size="small" type="link" loading={saving} disabled={!additions.length} onClick={() => handleChange([...new Set([...selectedIds, ...additions.map(item => item.skill.id)])])}>一键采用推荐</Button></div>
        {recommendations.map(({ skill, reason }) => <div key={skill.id} className="mb-2 last:mb-0">
          <div className="text-xs font-medium break-words">{skill.name} {selectedIds.includes(skill.id) && <Tag color="green">已绑定</Tag>}</div>
          <div className="text-xs text-gray-500 mt-1">{reason}</div>
        </div>)}
      </div> : <p className="text-xs text-gray-500 mb-3">{skills.length ? '暂未匹配到合适的 Skill。普通任务可以直接交给模型，无需强行绑定。' : '尚未发现已安装的 Skill。可先生成草稿，完善后安装。'}</p>}
      <Select mode="multiple" value={selectedIds} onChange={handleChange} disabled={saving} className="w-full"
        placeholder="手动补充 Skills，可搜索名称或说明" maxTagCount="responsive" aria-label="节点绑定 Skills"
        optionFilterProp="search" options={[
          ...skills.map(skill => ({ value: skill.id, label: skill.name, search: `${skill.name} ${skill.description}`, description: skill.description })),
          ...selectedIds.filter(id => !skills.some(skill => skill.id === id)).map(id => ({ value: id, label: `${id}（未找到）`, search: id, description: '此前绑定的 Skill，当前目录中未发现。' })),
        ]}
        optionRender={option => <div className="py-1"><div>{option.label}</div><div className="text-xs text-gray-400 whitespace-normal line-clamp-2 mt-1">{option.data.description || '暂无说明'}</div></div>} />
    </>}
    <div className="mt-3 flex items-center justify-between gap-2">
      <span className="text-xs text-gray-400">缺少合适的工作流程？</span>
      <Button size="small" onClick={() => setDraft(createSkillDraft(node, projectName))} disabled={saving}>AI 生成 Skill</Button>
    </div>
    {draft !== null && <SkillStudioDialog projectId={projectId} initialContent={draft} initialGoal={`${node.name}：${node.description || ''}`}
      onClose={() => setDraft(null)} bindAfterSave onSaved={async (skill, bind) => {
        setSkills(prev => [...prev.filter(item => item.id !== skill.id), skill])
        if (bind) {
          const current = await import('../../api').then(api => api.runApi.get(runId))
          const target = current.run.nodes.find((item: TaskNode) => item.id === node.id)
          const res = await nodeApi.updateSkills(runId, node.id, [...new Set([...(target?.skillIds || []), skill.id])])
          setSelectedIds(res.node.skillIds || []); onUpdate(res.node)
        }
      }} />}

  </section>
}
