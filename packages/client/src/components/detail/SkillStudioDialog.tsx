import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Input, Modal, Tabs } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { projectApi } from '../../api'
import type { SkillInfo } from '../../types'

export function SkillStudioDialog({ projectId, initialContent, initialGoal = '', onClose, onSaved, bindAfterSave }: {
  projectId: string; initialContent: string; initialGoal?: string; onClose: () => void
  onSaved: (skill: SkillInfo, bind: boolean) => Promise<void> | void; bindAfterSave?: boolean
}) {
  const [content, setContent] = useState(initialContent)
  const [goal, setGoal] = useState(initialGoal)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [model, setModel] = useState('')
  const [published, setPublished] = useState<SkillInfo>()
  const controller = useRef<AbortController | null>(null)
  const { message } = App.useApp()
  useEffect(() => () => controller.current?.abort(), [])
  const generate = async () => {
    if (controller.current) return
    const job = new AbortController(); controller.current = job
    setGenerating(true); setError('')
    try {
      const res = await projectApi.generateSkill(projectId, `${goal}\n\n当前草稿（可参考改写）：\n${content}`, job.signal)
      setContent(res.content); setModel(res.model)
    } catch (err) { if (!job.signal.aborted) setError((err as Error).message) }
    finally { controller.current = null; setGenerating(false) }
  }
  const publish = async (bind: boolean) => {
    setSaving(true); setError('')
    try {
      // A binding retry reuses the saved Skill; never creates a second file.
      const skill = published || (await projectApi.saveSkill(projectId, content)).skill
      setPublished(skill)
      await onSaved(skill, bind)
      message.success(bind ? 'Skill 已保存并绑定此节点' : 'Skill 已保存到项目库')
      onClose()
    } catch (err) { setError((err as Error).message) }
    finally { setSaving(false) }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'SKILL.md'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <Modal open title="Skill 工作台" width={860} onCancel={() => { if (!saving) onClose() }} maskClosable={false}
    footer={<div className="flex flex-wrap justify-end gap-2">
      <Button onClick={download} disabled={!content}>下载</Button>
      <Button disabled={generating || saving || !content.trim()} onClick={() => publish(false)} loading={saving}>保存到项目库</Button>
      {bindAfterSave && <Button type="primary" disabled={generating || saving || !content.trim()} onClick={() => publish(true)}>保存并绑定此节点</Button>}
    </div>}>
    <p className="text-xs text-gray-500 mb-3">1 描述用途 → 2 AI 生成或手动编写 → 3 检查预览 → 4 保存与绑定</p>
    <div className="rounded-xl bg-indigo-50/50 p-3 mb-3">
      <Input.TextArea aria-label="Skill 生成需求" placeholder="例如：为本项目编写接口回归测试流程，说明触发条件、测试步骤和验收标准" autoSize={{ minRows: 2, maxRows: 4 }} maxLength={6000} value={goal} disabled={generating || saving || !!published} onChange={e => setGoal(e.target.value)} />
      <div className="flex flex-wrap justify-between items-center gap-2 mt-2">
        <span className="text-xs text-gray-500">本机 Codex · 使用已启用 Codex 模型（优先 Universal） · 消耗当前账号额度{model && ` · 本次 ${model}`}</span>
        {generating ? <Button size="small" onClick={() => controller.current?.abort()}>取消生成</Button> : <Button type="primary" size="small" disabled={!goal.trim() || saving || !!published} onClick={generate}>AI 生成 / 改写</Button>}
      </div>
      {generating && <p role="status" className="text-xs text-indigo-600 mt-2">正在生成，最长等待 3 分钟。完成后会填入下方编辑器。</p>}
    </div>
    {error && <Alert type="error" showIcon title={error} className="mb-3" />}
    {published && <Alert type="info" title="文件已保存；如绑定失败，可重试绑定或关闭后在节点中选择。" className="mb-3" />}
    <Tabs items={[
      { key: 'edit', label: '编辑 SKILL.md', children: <Input.TextArea aria-label="Skill 内容" rows={15} value={content} disabled={generating || saving || !!published} onChange={e => setContent(e.target.value)} className="font-mono text-xs" /> },
      { key: 'preview', label: '预览', children: <div className="max-h-96 overflow-auto p-4 border border-gray-100 rounded-lg prose prose-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')}</ReactMarkdown></div> },
    ]} />
    <p className="text-xs text-gray-400 mt-2">保存为 AgentFlow 项目专属 Skill，执行时按节点绑定注入。同名文件不会覆盖；复制修改已有 Skill 时请修改 YAML 中的 name。</p>
  </Modal>
}
