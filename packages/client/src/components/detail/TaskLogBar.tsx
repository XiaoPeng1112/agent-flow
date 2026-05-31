import { useRef, useEffect, useMemo } from 'react'
import { Button, Badge } from 'antd'
import {
  CodeOutlined,
  UpOutlined,
  DownOutlined,
  ClearOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../../store/appStore'
import type { TaskLogEntry, TaskLogLevel } from '../../store/appStore'

const levelConfig: Record<TaskLogLevel, {
  icon: React.ReactNode
  color: string
  bgColor: string
}> = {
  info: { icon: <InfoCircleOutlined />, color: '#94a3b8', bgColor: 'transparent' },
  success: { icon: <CheckCircleOutlined />, color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.08)' },
  warning: { icon: <WarningOutlined />, color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.08)' },
  error: { icon: <CloseCircleOutlined />, color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.08)' },
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`
  return `${Math.floor(diff / 86400_000)}天前`
}

export function TaskLogBar() {
  const showTaskLog = useAppStore((s) => s.showTaskLog)
  const taskLogEntries = useAppStore((s) => s.taskLogEntries)
  const toggleTaskLog = useAppStore((s) => s.toggleTaskLog)
  const clearTaskLog = useAppStore((s) => s.clearTaskLog)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (showTaskLog && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [taskLogEntries.length, showTaskLog])

  // 按时间段分组（相邻 30 秒内的日志归为一组）
  const groupedEntries = useMemo(() => {
    const groups: { startTime: number; entries: TaskLogEntry[] }[] = []
    for (const entry of taskLogEntries) {
      const lastGroup = groups[groups.length - 1]
      if (lastGroup && entry.timestamp - lastGroup.entries[lastGroup.entries.length - 1].timestamp < 30_000) {
        lastGroup.entries.push(entry)
      } else {
        groups.push({ startTime: entry.timestamp, entries: [entry] })
      }
    }
    return groups
  }, [taskLogEntries])

  // 统计各级别数量
  const errorCount = taskLogEntries.filter(e => e.level === 'error').length
  const warningCount = taskLogEntries.filter(e => e.level === 'warning').length

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
          {taskLogEntries.length > 0 && (
            <Badge
              count={taskLogEntries.length}
              size="small"
              className="!text-[10px]"
              color="#6366f1"
            />
          )}
          {errorCount > 0 && (
            <Badge count={errorCount} size="small" color="#ef4444" />
          )}
          {warningCount > 0 && (
            <Badge count={warningCount} size="small" color="#f59e0b" />
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
        <div className="h-48 overflow-y-auto px-5 pb-3 bg-[#0f0f17]">
          {taskLogEntries.length === 0 ? (
            <div className="text-gray-500 py-6 text-center text-[11px]">
              等待 Agent 输出...
            </div>
          ) : (
            groupedEntries.map((group, gIdx) => (
              <div key={gIdx} className="mb-1">
                {/* 时间分组标头 */}
                <div className="flex items-center gap-2 py-1.5 sticky top-0 bg-[#0f0f17]/95 z-10">
                  <div className="h-px flex-1 bg-gray-700/50" />
                  <span className="text-[9px] text-gray-500 font-mono shrink-0">
                    {formatTime(group.startTime)} · {formatRelativeTime(group.startTime)}
                  </span>
                  <div className="h-px flex-1 bg-gray-700/50" />
                </div>

                {/* 组内日志条目 */}
                {group.entries.map((entry) => {
                  const config = levelConfig[entry.level]
                  return (
                    <div
                      key={entry.id}
                      className="flex items-start gap-2 px-2.5 py-1.5 rounded-md mb-0.5 transition-colors hover:bg-white/[0.03]"
                      style={{ backgroundColor: config.bgColor }}
                    >
                      {/* 时间戳 */}
                      <span className="text-[9px] text-gray-600 font-mono shrink-0 mt-px w-[52px]">
                        {formatTime(entry.timestamp)}
                      </span>

                      {/* 级别图标 */}
                      <span className="text-[11px] shrink-0 mt-px" style={{ color: config.color }}>
                        {config.icon}
                      </span>

                      {/* 消息内容 */}
                      <div className="flex-1 min-w-0">
                        <span
                          className="text-[11px] leading-[1.6] break-all"
                          style={{ color: entry.level === 'error' ? '#fca5a5' : entry.level === 'success' ? '#6ee7b7' : entry.level === 'warning' ? '#fcd34d' : '#d1d5db' }}
                        >
                          {entry.message}
                        </span>
                        {/* meta 信息 */}
                        {entry.meta && (
                          <span className="text-[9px] text-gray-600 ml-2">
                            {entry.meta.turnIndex !== undefined && `Turn#${entry.meta.turnIndex}`}
                            {entry.meta.tokens && ` · ${entry.meta.tokens.toLocaleString()} tok`}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  )
}
