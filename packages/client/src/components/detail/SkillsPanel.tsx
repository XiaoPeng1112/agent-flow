import { useState, useEffect, useCallback } from 'react'
import { Alert, App, Card, Tag, Empty, Button, Input, Modal, Select, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import { projectApi, runApi, nodeApi } from '../../api'
import { useAppStore } from '../../store/appStore'
import type { Project, SkillInfo, Run } from '../../types'
import { createSkillDraft } from '../../utils/skillRecommendations'
import { SkillStudioDialog } from './SkillStudioDialog'

export function SkillsPanel({ project }: { project: Project }) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const [opening, setOpening] = useState<string>()
  const [binding, setBinding] = useState<SkillInfo>()
  const [runs, setRuns] = useState<Run[]>([])
  const [target, setTarget] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [loadingTargets, setLoadingTargets] = useState(false)
  const { message } = App.useApp()
  const navigate = useNavigate()
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setSkills((await projectApi.getSkills(project.id)).skills) }
    catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }, [project.id])
  useEffect(() => { void load() }, [load])
  const open = async (skill: SkillInfo) => {
    setOpening(skill.id)
    try { setDraft((await projectApi.getSkillContent(project.id, skill.id)).content) }
    catch (err) { message.error((err as Error).message) }
    finally { setOpening(undefined) }
  }
  const chooseNode = async (skill: SkillInfo) => {
    setTarget(undefined); setBinding(skill); setRuns([]); setLoadingTargets(true)
    try { setRuns((await runApi.list(project.id)).runs) }
    catch (err) { message.error((err as Error).message) }
    finally { setLoadingTargets(false) }
  }
  const targets = runs.flatMap(run => run.nodes.filter(node => ['pending', 'ready'].includes(node.status)).map(node => ({ value: `${run.id}/${node.id}`, label: `${run.name} / ${node.name}`, runId: run.id, nodeId: node.id })))
  const bind = async () => {
    const entry = targets.find(item => item.value === target)
    if (!entry || !binding) return
    setBusy(true)
    try {
      const { run } = await runApi.get(entry.runId)
      const node = run.nodes.find((n: { id: string }) => n.id === entry.nodeId)
      const res = await nodeApi.updateSkills(run.id, entry.nodeId, [...new Set([...(node?.skillIds || []), binding.id])])
      useAppStore.getState().updateNode(run.id, res.node)
      setBinding(undefined); message.success('已绑定，进入流程查看节点')
      useAppStore.getState().setRunDetailTab('dag')
      navigate(`/projects/${project.id}/runs/${run.id}?node=${encodeURIComponent(entry.nodeId)}`)
    } catch (err) { message.error((err as Error).message) }
    finally { setBusy(false) }
  }
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div><h3 className="text-base font-semibold">项目 Skills</h3><p className="text-xs text-gray-500 mt-1">将重复工作沉淀为流程：生成、查看、复制修改，再绑定到待执行节点。</p></div>
      <div className="flex gap-2"><Button loading={loading} onClick={load}>刷新</Button><Button type="primary" disabled={project.isDemo} onClick={() => setDraft(createSkillDraft({ name: '项目工作流程' }, project.name))}>新建 / AI 生成</Button></div>
    </div>
    <Input.Search aria-label="搜索 Skills" placeholder="搜索名称、说明或触发词" value={query} onChange={e => setQuery(e.target.value)} className="mb-4 max-w-lg" allowClear />
    {error && <Alert type="error" showIcon title={error} className="mb-3" />}
    <Spin spinning={loading && !skills.length}>
      {!loading && !skills.length && <Empty description="尚未发现 Skills。新建一个项目 Skill，或刷新已安装目录。" />}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {skills.filter(skill => `${skill.name} ${skill.description} ${skill.triggers.join(' ')}`.toLowerCase().includes(query.toLowerCase())).map(skill => <Card key={skill.path} className="h-full" styles={{ body: { padding: 18 } }}>
          <div className="flex flex-wrap items-center gap-2 mb-2"><h4 className="text-sm font-semibold break-all">{skill.name}</h4><Tag variant="filled">{skill.path.includes('/project-skills/') ? '项目专属' : skill.path.startsWith(project.path.replace(/\/$/, '') + '/') ? '项目目录' : '已安装'}</Tag></div>
          <p className="text-xs text-gray-500 line-clamp-3 min-h-12" title={skill.description}>{skill.description}</p>
          <div className="flex flex-wrap gap-1 my-3">{skill.triggers.slice(0, 3).map(t => <Tag key={t}>{t}</Tag>)}</div>
          <div className="flex flex-wrap gap-2"><Button size="small" disabled={project.isDemo || !!opening} loading={opening === skill.id} onClick={() => open(skill)}>查看 / 复制编辑</Button><Button size="small" type="primary" disabled={project.isDemo || loadingTargets} onClick={() => chooseNode(skill)}>绑定节点</Button></div>
        </Card>)}
      </div>
      {!loading && skills.length > 0 && !skills.some(skill => `${skill.name} ${skill.description} ${skill.triggers.join(' ')}`.toLowerCase().includes(query.toLowerCase())) && <Empty description="没有匹配的 Skills" />}
    </Spin>
    {draft !== null && <SkillStudioDialog projectId={project.id} initialContent={draft} onClose={() => setDraft(null)} onSaved={async () => { await load() }} />}
    <Modal title={`绑定 ${binding?.name || 'Skill'} 到节点`} open={!!binding} onCancel={() => { if (!busy) setBinding(undefined) }} onOk={bind} confirmLoading={busy} okText="绑定并打开流程" okButtonProps={{ disabled: !target || loadingTargets }}>
      <p className="text-xs text-gray-500 mb-3">保留节点已有绑定，只增加当前 Skill。仅列出待执行节点。</p>
      <Select aria-label="选择绑定节点" className="w-full" loading={loadingTargets} disabled={busy} showSearch optionFilterProp="label" value={target} onChange={setTarget} options={targets} placeholder="选择工作流 / 节点" />
      {!loadingTargets && !targets.length && <p className="text-xs text-gray-500 mt-3">暂无可绑定节点，请先创建 Run。</p>}
    </Modal>
  </div>
}
