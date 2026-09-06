import { useCallback, useEffect, useState } from 'react'
import { Alert, App, Select, Input, Button, Card, Tabs, Tag } from 'antd'
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
  return <Card title="模型配置" extra={<Button disabled={disabled} loading={loading} onClick={() => load(true)}>刷新模型</Button>}>
    <p className="text-xs text-gray-500 mb-4">本机全局配置 · 保存后用于新执行，刷新列表会保留当前选择。</p>
    {(error || catalog?.warning) && <Alert type="warning" showIcon title={error || catalog?.warning} className="mb-3" />}
    <Tabs items={(['codex', 'claude'] as const).map(provider => ({
      key: provider,
      label: provider === 'codex' ? 'OpenAI Codex' : 'Anthropic Claude',
      children: <>
        <div className="rounded-lg bg-gray-50 px-3 py-2 mb-2 text-xs text-gray-500">
          {provider === 'codex'
            ? `已发现 ${catalog?.models.filter(m => m.discovered).length || 0} 个模型；候选模型的执行权限由 CLI 校验。`
            : '显示当前已配置的模型。Claude 尚未接入模型发现，可跟随 CLI 默认或填写模型 ID；已配置不代表已验证可用。'}
          {provider === 'codex' && catalog?.fetchedAt && <span className="ml-2">更新于 {new Date(catalog.fetchedAt).toLocaleTimeString()}</span>}
        </div>
        {agents.filter(a => a.type === provider).map(agent => <ModelRow key={agent.id} agent={agent} disabled={disabled}
          options={provider === 'codex' ? catalog?.models || [] : []} save={save} />)}
      </>,
    }))} />
  </Card>
}

function ModelRow({ agent, options, disabled, save }: { agent: AgentConfig; options: Array<{ id: string; name: string; discovered?: boolean }>; disabled?: boolean; save: (id: string, model: string) => Promise<void> }) {
  const [value, setValue] = useState(agent.model || '')
  const [saving, setSaving] = useState(false)
  const [custom, setCustom] = useState(false)
  const advice = roleAdvice[agent.id]
  // Keep saved and newly typed IDs selectable even when discovery is unavailable.
  const displayOptions = [...options]
  for (const id of [agent.model, value]) {
    if (id && !displayOptions.some(option => option.id === id)) displayOptions.push({ id, name: id })
  }
  const manual = custom
  const { message } = App.useApp()
  useEffect(() => setValue(agent.model || ''), [agent.id, agent.model])
  const submit = async () => {
    setSaving(true)
    try { await save(agent.id, value) } catch (err) { message.error((err as Error).message) } finally { setSaving(false) }
  }
  const choices = [
    { value: '', label: 'Default — 跟随本机 CLI 默认' },
    ...displayOptions.map(option => ({ value: option.id, shortLabel: option.name, label: `${option.name}${advice?.model === option.id ? ' · 本角色推荐' : ''} · ${option.discovered ? 'CLI 已发现' : '候选未验证'}${modelPurpose[option.id] ? ' · ' + modelPurpose[option.id] : ''}` })),
    { value: '__custom__', label: '自定义模型 ID…' },
  ]
  const selected = options.find(option => option.id === value)
  const dirty = value.trim() !== (agent.model || '')
  return <div className="border-b border-gray-100 py-4 last:border-0">
    <div className="grid gap-3 md:grid-cols-[210px_minmax(0,1fr)_auto] items-start">
      <div>
        <div className="font-medium text-sm text-gray-800">{agent.name.replace(/ \([^)]*\)$/, '')}</div>
        {advice && <div className="text-xs text-gray-400 mt-1">{advice.purpose}</div>}
      </div>
      <div className="min-w-0">
        <Select className="w-full" aria-label={`${agent.name} 模型`} disabled={disabled || saving}
          value={manual ? '__custom__' : value} showSearch optionFilterProp="label" options={choices}
          labelRender={item => displayOptions.find(option => option.id === item.value)?.name || item.label}
          onChange={next => { setCustom(next === '__custom__'); if (next !== '__custom__') setValue(next) }} />
        {manual && <Input className="mt-2" aria-label={`${agent.name} 自定义模型 ID`} placeholder="输入 CLI 支持的模型 ID" disabled={disabled || saving} value={value} onChange={e => setValue(e.target.value)} />}
        <div className="flex flex-wrap items-center gap-1 mt-2 text-xs text-gray-400">
          <Tag bordered={false} color={dirty ? 'orange' : 'default'}>{dirty ? '未保存' : '已保存'}</Tag>
          {value && <Tag bordered={false} color={selected?.discovered ? 'green' : 'default'}>{selected?.discovered ? 'CLI 已发现' : agent.type === 'claude' ? '手动配置' : '未验证候选'}</Tag>}
          {advice?.model === value && <Tag bordered={false} color="purple">角色推荐</Tag>}
          {value && <span>{modelPurpose[value]}</span>}
        </div>
      </div>
      <div className="flex gap-2">
        {advice && <Button size="small" disabled={disabled || saving || value === advice.model} onClick={() => { setCustom(false); setValue(advice.model) }}>用推荐</Button>}
        <Button size="small" type={dirty ? 'primary' : 'default'} disabled={disabled || !dirty || (manual && !value.trim())} loading={saving} onClick={submit}>保存</Button>
      </div>
    </div>
  </div>
}
