import { useRef, useEffect } from 'react'
import { Button, Badge } from 'antd'
import {
  CodeOutlined,
  UpOutlined,
  DownOutlined,
  ClearOutlined,
} from '@ant-design/icons'
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
  }, [taskLogContent.length, showTaskLog])

  return (
    <div className="border-t border-gray-100 bg-white/95 backdrop-blur-sm">
      {/* 折叠栏头部 */}
      <div
        className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-gray-50/80 transition-colors"
        onClick={toggleTaskLog}
      >
        <div className="flex items-center gap-2.5">
          <CodeOutlined className="text-gray-400" />
          <span className="text-[13px] font-medium text-gray-600">
            任务日志
          </span>
          {taskLogContent.length > 0 && (
            <Badge
              count={taskLogContent.length}
              size="small"
              className="!text-[10px]"
              color="#6366f1"
            />
          )}
          {showTaskLog ? (
            <DownOutlined className="text-[10px] text-gray-400" />
          ) : (
            <UpOutlined className="text-[10px] text-gray-400" />
          )}
        </div>
        {showTaskLog && (
          <Button
            type="text"
            size="small"
            icon={<ClearOutlined />}
            onClick={(e) => { e.stopPropagation(); clearTaskLog() }}
            className="!text-gray-400 hover:!text-gray-600"
          >
            清空
          </Button>
        )}
      </div>

      {/* 日志内容 */}
      {showTaskLog && (
        <div className="h-40 overflow-y-auto px-6 pb-3 bg-[#0f0f17] font-mono text-[11px] leading-[1.7]">
          {taskLogContent.length === 0 ? (
            <div className="text-gray-500 py-6 text-center text-[11px]">
              等待 Agent 输出...
            </div>
          ) : (
            taskLogContent.map((line, idx) => (
              <div key={idx} className="py-px whitespace-pre-wrap break-all text-gray-300">
                <span className="text-gray-600 mr-2.5 select-none text-[10px]">{String(idx + 1).padStart(3, ' ')}</span>
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
