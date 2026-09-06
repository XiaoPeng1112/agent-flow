import { useCallback, useEffect, useState } from 'react'
import { Alert, App, Select, Input, Button, Card } from 'antd'
import { agentApi } from '../../api'
import { useAppStore } from '../../store/appStore'
import type { AgentConfig } from '../../types'

const roleAdvice: Record<string, { model: string; purpose: string }> = {
  'codex-planner': { model: 'gpt-6-astra', purpose: '需求拆解、架构设计与复杂规划' },
  'codex-manager': { model: 'gpt-5.6-sol', purpose: '任务分派、代码审核与质量验收' },
  'codex-coder': { model: 'gpt-5.6-sol', purpose: '复杂编码、重构与问题修复' },
  'codex-tester': { model: 'gpt-5.6-terra', purpose: '编写测试、分析失败与回归检查' },
  'codex-universal': { model: 'gpt-5.6-terra', purpose: '日常通用任务，平衡能力与开销' },
}
const modelPurpose: Record<string, string> = {
  'gpt-6-astra': '复杂规划与多步骤任务', 'gpt-5.6-sol': '复杂编码与审核',
  'gpt-5.6-terra': '日常开发与测试', 'gpt-5.6-luna': '明确、重复的轻量任务',
  'gpt-5.5': '上一代通用模型', 'gpt-5.4-mini': '轻量任务', 'gpt-5.3-codex-spark': '快速迭代，纯文本',
}
type Catalog = Awaited<ReturnType<typeof agentApi.getModels>>
export function ModelSettingsPanel({ agents, disabled }: { agents: AgentConfig[]; disabled?: boolean }) {
  const [catalog, setCatalog] = useState<Catalog>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { message } = App.useApp()
  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    try { setCatalog(await agentApi.getModels(refresh)); setError('') }
    catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { if (!disabled) void load() }, [disabled, load])
  const save = async (id: string, model: string) => {
    const { agent } = await agentApi.setModel(id, model.trim())
    const store = useAppStore.getState()
    store.setAgents(store.agents.map(item => item.id === id ? { ...item, ...agent } : item))
    message.success('模型选择已保存，新执行生效')
  }
  return <Card title="模型选择（本机全局）" extra={<Button disabled={disabled} loading={loading} onClick={() => load(true)}>刷新模型</Button>}>
    <p className="mb-3 text-gray-500">点击下拉框选择模型；每个角色下方显示推荐用途。选择“自定义模型”可手动填写，修改后点击保存。刷新列表不会改变已保存的选择。</p>
    {(error || catalog?.warning) && <Alert type="warning" showIcon message={error || catalog?.warning} className="mb-3" />}
    <p className="mb-3 text-gray-500">{catalog?.source === 'cli' ? 'CLI 已发现的模型与内置候选合并展示；实际执行仍取决于账号权限和网络。' : '来源：内置候选，尚未验证本机可用性。'}{catalog?.fetchedAt ? ` 更新于 ${new Date(catalog.fetchedAt).toLocaleString()}` : ''}</p>
    {agents.filter(a => a.type !== 'custom-cli').map(agent => <ModelRow key={agent.id} agent={agent} disabled={disabled}
      options={agent.type === 'codex' ? catalog?.models || [] : []} save={save} />)}
  </Card>
}
function ModelRow({ agent, options, disabled, save }: { agent: AgentConfig; options: Array<{ id: string; name: string; discovered?: boolean }>; disabled?: boolean; save: (id: string, model: string) => Promise<void> }) {
  const [value, setValue] = useState(agent.model || '')
  const [saving, setSaving] = useState(false)
  const [custom, setCustom] = useState(false)
  const advice = roleAdvice[agent.id]
  const known = !value || options.some(option => option.id === value)
  const manual = custom || !known
  const { message } = App.useApp()
  useEffect(() => setValue(agent.model || ''), [agent.id, agent.model])
  const submit = async () => {
    setSaving(true)
    try { await save(agent.id, value) } catch (err) { message.error((err as Error).message) } finally { setSaving(false) }
  }
  const choices = [
    { value: '', label: 'Default — 跟随本机 CLI 默认' },
    ...options.map(option => ({ value: option.id, label: `${option.name}${advice?.model === option.id ? ' · 本角色推荐' : ''} · ${option.discovered ? 'CLI 已发现' : '候选未验证'}${modelPurpose[option.id] ? ' · ' + modelPurpose[option.id] : ''}` })),
    { value: '__custom__', label: '自定义模型 ID…' },
  ]
  return <div className="border-b border-gray-100 py-4 last:border-0">
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-56 shrink-0">
        <div>{agent.name.replace(/ \([^)]*\)$/, '')}</div>
        {advice && <div className="text-xs text-gray-500 mt-1">{advice.purpose}</div>}
      </div>
      <Select className="min-w-64 flex-1" aria-label={`${agent.name} 模型`} disabled={disabled || saving}
        value={manual ? '__custom__' : value} showSearch optionFilterProp="label" options={choices}
        onChange={next => { setCustom(next === '__custom__'); if (next !== '__custom__') setValue(next) }} />
      {advice && <Button disabled={disabled || saving} onClick={() => { setCustom(false); setValue(advice.model) }}>使用推荐</Button>}
      <Button disabled={disabled || value.trim() === (agent.model || '') || (manual && !value.trim())} loading={saving} onClick={submit}>保存</Button>
    </div>
    {manual && <Input className="mt-3" aria-label={`${agent.name} 自定义模型 ID`} placeholder="输入模型 ID，例如 gpt-6-astra" disabled={disabled || saving} value={value} onChange={e => setValue(e.target.value)} />}
    <div className="text-xs text-gray-500 mt-2">已保存：{agent.model || '跟随 CLI 默认'}{advice ? `；推荐：${advice.model}` : ''}</div>
    {value && !options.some(option => option.id === value && option.discovered) && <div className="text-xs text-amber-600 mt-1">此模型尚未被 CLI 发现，实际执行可用性未验证。</div>}
  </div>
}
