import { useAppStore } from '../../store/appStore'
import { CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react'
import type { Project } from '../../types'

interface Props {
  project: Project
}

const statusConfig = {
  pending: { icon: Clock, color: 'text-slate-400', bg: 'bg-slate-50', label: '等待中' },
  running: { icon: Loader2, color: 'text-amber-500', bg: 'bg-amber-50', label: '执行中' },
  completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50', label: '完成' },
  error: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', label: '失败' },
  cancelled: { icon: XCircle, color: 'text-slate-400', bg: 'bg-slate-50', label: '已取消' },
}

export function TasksPanel({ project }: Props) {
  const tasks = useAppStore((s) => s.tasks)
  const projectTasks = tasks.filter((t) => t.projectId === project.id)

  if (projectTasks.length === 0) {
    return (
      <div className="p-6">
        <h3 className="text-base font-semibold text-slate-800 mb-4">任务历史</h3>
        <div className="text-center py-12">
          <Clock className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">暂无任务执行记录</p>
          <p className="text-xs text-slate-400 mt-1">通过工作流面板触发任务后，执行记录会显示在这里</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-slate-800">任务历史</h3>
        <span className="text-xs text-slate-500">共 {projectTasks.length} 条记录</span>
      </div>

      <div className="space-y-2">
        {projectTasks.map((task) => {
          const config = statusConfig[task.status]
          const Icon = config.icon
          return (
            <div
              key={task.id}
              className={`p-4 bg-white border border-slate-200 rounded-xl`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-1.5 rounded-lg ${config.bg}`}>
                  <Icon className={`w-4 h-4 ${config.color} ${task.status === 'running' ? 'animate-spin' : ''}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">{task.prompt}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] rounded ${config.bg} ${config.color}`}>
                      {config.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                    <span>Agent: {task.agentId}</span>
                    <span>{new Date(task.createdAt).toLocaleString()}</span>
                    {task.completedAt && (
                      <span>耗时: {Math.round((task.completedAt - (task.startedAt || task.createdAt)) / 1000)}s</span>
                    )}
                  </div>
                  {task.output && (
                    <pre className="mt-2 p-2 bg-slate-50 rounded text-xs text-slate-600 font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {task.output.slice(0, 500)}
                      {task.output.length > 500 && '...'}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
