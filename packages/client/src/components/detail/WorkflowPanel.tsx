import { useState } from 'react'
import { Play, ChevronRight } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { executeAgent } from '../../api'
import type { Project, WorkflowTemplate, WorkflowStep } from '../../types'

interface Props {
  project: Project
}

const stepTypeColors: Record<string, string> = {
  requirement: 'bg-blue-100 text-blue-700 border-blue-200',
  prd: 'bg-purple-100 text-purple-700 border-purple-200',
  design: 'bg-pink-100 text-pink-700 border-pink-200',
  ui: 'bg-orange-100 text-orange-700 border-orange-200',
  development: 'bg-green-100 text-green-700 border-green-200',
  bugfix: 'bg-red-100 text-red-700 border-red-200',
  testing: 'bg-teal-100 text-teal-700 border-teal-200',
}

const stepTypeLabels: Record<string, string> = {
  requirement: '需求',
  prd: 'PRD',
  design: '设计',
  ui: 'UI',
  development: '开发',
  bugfix: '修复',
  testing: '测试',
}

export function WorkflowPanel({ project }: Props) {
  const workflowTemplates = useAppStore((s) => s.workflowTemplates)
  const agents = useAppStore((s) => s.agents)
  const addTask = useAppStore((s) => s.addTask)
  const appendTaskLog = useAppStore((s) => s.appendTaskLog)
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null)
  const [runningStepId, setRunningStepId] = useState<string | null>(null)
  const [stepPrompts, setStepPrompts] = useState<Record<string, string>>({})

  const handleRunStep = async (step: WorkflowStep) => {
    const prompt = stepPrompts[step.id] || step.prompt || step.description
    const agentId = step.agentId || agents[0]?.id || 'claude-cli'

    if (!prompt.trim()) return

    setRunningStepId(step.id)
    appendTaskLog(`[${step.name}] 开始执行...`)
    appendTaskLog(`> Agent: ${agentId} | Prompt: ${prompt}`)

    const task = {
      id: `task_${Date.now()}`,
      projectId: project.id,
      workflowId: selectedTemplate?.id,
      stepId: step.id,
      agentId,
      prompt,
      output: '',
      status: 'running' as const,
      createdAt: Date.now(),
      startedAt: Date.now(),
    }
    addTask(task)

    try {
      const result = await executeAgent(agentId, prompt, project.path)
      appendTaskLog(`[${step.name}] 执行完成 ✓`)
      appendTaskLog(result.task?.output || '(无输出)')
    } catch (err: any) {
      appendTaskLog(`[${step.name}] 执行失败: ${err.message}`)
    } finally {
      setRunningStepId(null)
    }
  }

  return (
    <div className="p-6">
      {/* 模板选择 */}
      {!selectedTemplate ? (
        <div>
          <h3 className="text-base font-semibold text-slate-800 mb-4">选择工作流模板</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workflowTemplates.map((tpl) => (
              <div
                key={tpl.id}
                onClick={() => setSelectedTemplate(tpl)}
                className="p-4 bg-white border border-slate-200 rounded-xl cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all"
              >
                <h4 className="text-sm font-semibold text-slate-800">{tpl.name}</h4>
                <p className="text-xs text-slate-500 mt-1">{tpl.description}</p>
                <div className="flex flex-wrap gap-1 mt-3">
                  {tpl.steps.map((step) => (
                    <span
                      key={step.id}
                      className={`px-1.5 py-0.5 text-[10px] rounded border ${stepTypeColors[step.type] || 'bg-slate-100 text-slate-600'}`}
                    >
                      {stepTypeLabels[step.type] || step.type}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          {/* 返回 + 模板名 */}
          <div className="flex items-center gap-2 mb-6">
            <button
              onClick={() => setSelectedTemplate(null)}
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              ← 返回模板列表
            </button>
            <span className="text-slate-300">|</span>
            <h3 className="text-base font-semibold text-slate-800">{selectedTemplate.name}</h3>
          </div>

          {/* Pipeline 步骤展示 */}
          <div className="space-y-3">
            {selectedTemplate.steps.map((step, idx) => (
              <div
                key={step.id}
                className="bg-white border border-slate-200 rounded-xl p-4 transition-all hover:shadow-sm"
              >
                <div className="flex items-center gap-3">
                  {/* 步骤编号 */}
                  <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">
                    {idx + 1}
                  </div>

                  {/* 步骤信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{step.name}</span>
                      <span className={`px-1.5 py-0.5 text-[10px] rounded border ${stepTypeColors[step.type]}`}>
                        {stepTypeLabels[step.type]}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>
                  </div>

                  {/* 执行按钮 */}
                  <button
                    onClick={() => handleRunStep(step)}
                    disabled={runningStepId !== null}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      runningStepId === step.id
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                    } disabled:opacity-50`}
                  >
                    <Play className="w-3 h-3" />
                    {runningStepId === step.id ? '执行中...' : '执行'}
                  </button>
                </div>

                {/* Prompt 输入 */}
                <div className="mt-3">
                  <textarea
                    value={stepPrompts[step.id] || ''}
                    onChange={(e) =>
                      setStepPrompts((p) => ({ ...p, [step.id]: e.target.value }))
                    }
                    placeholder={step.prompt || `输入具体需求描述，如：${step.description}...`}
                    rows={2}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none font-mono bg-slate-50"
                  />
                </div>

                {/* 步骤箭头 */}
                {idx < selectedTemplate.steps.length - 1 && (
                  <div className="flex justify-center mt-2">
                    <ChevronRight className="w-4 h-4 text-slate-300 rotate-90" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
