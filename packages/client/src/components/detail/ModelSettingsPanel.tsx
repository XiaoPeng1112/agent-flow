import { useCallback, useEffect, useState } from 'react'
import { Alert, App, AutoComplete, Button, Card } from 'antd'
import { agentApi } from '../../api'
import { useAppStore } from '../../store/appStore'
import type { AgentConfig } from '../../types'

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
    <p className="mb-3 text-gray-500">留空跟随 CLI 默认；也可选择或输入模型 ID。刷新列表不会更改已保存的选择。</p>
    {(error || catalog?.warning) && <Alert type="warning" showIcon message={error || catalog?.warning} className="mb-3" />}
    <p className="mb-3 text-gray-500">{catalog?.source === 'cli' ? 'CLI 已发现的模型与内置候选合并展示；实际执行仍取决于账号权限和网络。' : '来源：内置候选，尚未验证本机可用性。'}{catalog?.fetchedAt ? ` 更新于 ${new Date(catalog.fetchedAt).toLocaleString()}` : ''}</p>
    {agents.filter(a => a.type !== 'custom-cli').map(agent => <ModelRow key={agent.id} agent={agent} disabled={disabled}
      options={agent.type === 'codex' ? catalog?.models || [] : []} save={save} />)}
  </Card>
}
function ModelRow({ agent, options, disabled, save }: { agent: AgentConfig; options: Array<{ id: string; name: string; discovered?: boolean }>; disabled?: boolean; save: (id: string, model: string) => Promise<void> }) {
  const [value, setValue] = useState(agent.model || '')
  const [saving, setSaving] = useState(false)
  const { message } = App.useApp()
  useEffect(() => setValue(agent.model || ''), [agent.id, agent.model])
  const submit = async () => {
    setSaving(true)
    try { await save(agent.id, value) } catch (err) { message.error((err as Error).message) } finally { setSaving(false) }
  }
  return <div className="flex flex-wrap items-center gap-3 mb-3">
    <span className="w-56">{agent.name.replace(/ \([^)]*\)$/, '')}</span>
    <AutoComplete className="min-w-64 flex-1" disabled={disabled || saving} value={value} onChange={setValue}
      placeholder="Default — 跟随 CLI 默认" allowClear
      options={options.map(option => ({ value: option.id, label: `${option.name} — ${option.discovered ? 'CLI 已发现' : '候选，未发现'}` }))}
      filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} />
    <Button disabled={disabled || saving} onClick={() => setValue('')}>跟随 CLI</Button>
    <Button disabled={disabled || value.trim() === (agent.model || '')} loading={saving} onClick={submit}>保存</Button>
    {value && !options.some(option => option.id === value && option.discovered) && <span className="text-xs text-gray-500">自定义或未发现的模型，执行可用性未验证</span>}
  </div>
}
