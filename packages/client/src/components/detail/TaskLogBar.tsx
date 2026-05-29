import { useRef, useEffect } from 'react'
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { useAppStore } from '../../store/appStore'

export function TaskLogBar() {
  const showTaskLog = useAppStore((s) => s.showTaskLog)
  const taskLogContent = useAppStore((s) => s.taskLogContent)
  const toggleTaskLog = useAppStore((s) => s.toggleTaskLog)
  const clearTaskLog = useAppStore((s) => s.clearTaskLog)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showTaskLog && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [taskLogContent, showTaskLog])

  return (
    <div className="border-t border-slate-200 bg-white">
      {/* 展开/收起按钮栏 */}
      <div
        onClick={toggleTaskLog}
        className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {showTaskLog ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          )}
          <span className="text-xs font-medium text-slate-600">
            任务日志 {taskLogContent.length > 0 && `(${taskLogContent.length})`}
          </span>
        </div>
        {showTaskLog && taskLogContent.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              clearTaskLog()
            }}
            className="p-1 hover:bg-slate-100 rounded"
          >
            <Trash2 className="w-3 h-3 text-slate-400" />
          </button>
        )}
      </div>

      {/* 日志内容 */}
      {showTaskLog && (
        <div className="h-40 overflow-y-auto border-t border-slate-100 bg-slate-900 px-4 py-2 font-mono text-xs">
          {taskLogContent.length === 0 ? (
            <p className="text-slate-500">暂无日志输出...</p>
          ) : (
            taskLogContent.map((line, i) => (
              <div
                key={i}
                className={`py-0.5 ${
                  line.startsWith('[') && line.includes('失败')
                    ? 'text-red-400'
                    : line.startsWith('[') && line.includes('完成')
                    ? 'text-green-400'
                    : line.startsWith('>')
                    ? 'text-indigo-400'
                    : 'text-slate-300'
                }`}
              >
                {line}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  )
}
