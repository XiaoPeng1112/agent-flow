import { useState, useEffect, useMemo } from 'react'
import { Button, Tag, Select, Empty, Spin, App } from 'antd'
import {
  CloseCircleOutlined,
  FileOutlined,
  FileAddOutlined,
  DeleteOutlined,
  EditOutlined,
  BranchesOutlined,
  MergeCellsOutlined,
  PlusOutlined,
  MinusOutlined,
} from '@ant-design/icons'
import { diffReviewApi } from '../../api'
import type { Run } from '../../types'

interface Props {
  run: Run
}

interface DiffFile {
  path: string
  additions: number
  deletions: number
  status: 'added' | 'modified' | 'deleted' | 'renamed'
}

interface DiffLine {
  type: 'add' | 'delete' | 'context'
  content: string
  oldLineNo?: number
  newLineNo?: number
}

interface DiffHunk {
  header: string
  lines: DiffLine[]
}

interface FileDiff {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

interface DiffReview {
  turnId: string
  nodeId: string
  runId: string
  baseBranch: string
  workBranch: string
  baseCommit: string
  headCommit: string
  files: DiffFile[]
  fileDiffs: FileDiff[]
  summary: {
    filesChanged: number
    totalAdditions: number
    totalDeletions: number
  }
  createdAt: number
}

type MergeStrategy = 'merge' | 'squash' | 'rebase'

const fileStatusConfig = {
  added: { icon: <FileAddOutlined />, color: '#10b981', label: 'Added', bgColor: '#ecfdf5' },
  modified: { icon: <EditOutlined />, color: '#f59e0b', label: 'Modified', bgColor: '#fffbeb' },
  deleted: { icon: <DeleteOutlined />, color: '#ef4444', label: 'Deleted', bgColor: '#fef2f2' },
  renamed: { icon: <FileOutlined />, color: '#6366f1', label: 'Renamed', bgColor: '#eef2ff' },
}

export function DiffReviewPanel({ run }: Props) {
  const [reviews, setReviews] = useState<DiffReview[]>([])
  const [selectedReview, setSelectedReview] = useState<DiffReview | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>('squash')
  const [loading, setLoading] = useState(false)
  const [merging, setMerging] = useState(false)
  const { message } = App.useApp()

  // 找到所有处于 wait_user_review 状态的节点
  const reviewableNodes = useMemo(() =>
    run.nodes.filter(n => n.status === 'wait_user_review' || n.status === 'completed'),
    [run.nodes]
  )

  // 加载已有 reviews
  useEffect(() => {
    const loadReviews = async () => {
      setLoading(true)
      try {
        const allReviews: DiffReview[] = []
        for (const node of reviewableNodes) {
          const res = await diffReviewApi.getForNode(run.id, node.id)
          if (res.reviews?.length) {
            allReviews.push(...res.reviews)
          }
        }
        setReviews(allReviews)
        if (allReviews.length > 0 && !selectedReview) {
          setSelectedReview(allReviews[0])
        }
      } catch {
        // 没有 diff review 数据是正常的
      } finally {
        setLoading(false)
      }
    }
    if (reviewableNodes.length > 0) {
      loadReviews()
    }
  }, [run.id, reviewableNodes.length])

  const handleMerge = async () => {
    if (!selectedReview) return
    setMerging(true)
    try {
      const res = await diffReviewApi.merge(
        selectedReview.runId,
        selectedReview.nodeId,
        selectedReview.turnId,
        mergeStrategy
      )
      if (res.success) {
        message.success(`合入成功！影响 ${res.filesAffected} 个文件`)
        // 移除已合入的 review
        setReviews(prev => prev.filter(r => r.turnId !== selectedReview.turnId))
        setSelectedReview(null)
      } else {
        message.error('合入失败')
      }
    } catch (err: any) {
      message.error(`合入失败: ${err.message}`)
    } finally {
      setMerging(false)
    }
  }

  const handleDiscard = async () => {
    if (!selectedReview) return
    try {
      await diffReviewApi.discard(
        selectedReview.runId,
        selectedReview.nodeId,
        selectedReview.turnId
      )
      message.success('已丢弃工作分支')
      setReviews(prev => prev.filter(r => r.turnId !== selectedReview.turnId))
      setSelectedReview(null)
    } catch (err: any) {
      message.error(`丢弃失败: ${err.message}`)
    }
  }

  // 当前选中的文件 diff
  const currentFileDiff = useMemo(() => {
    if (!selectedReview || !selectedFile) return null
    return selectedReview.fileDiffs.find(f => f.path === selectedFile)
  }, [selectedReview, selectedFile])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spin tip="加载 Diff Review 数据..." />
      </div>
    )
  }

  if (reviews.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Empty
          description="暂无 Diff Review 数据"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <p className="text-[11px] text-gray-400 mt-2">
            当 Agent 在 Git Worktree 中产出代码后，Diff Review 会自动生成
          </p>
        </Empty>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* 顶部：Review 选择和操作栏 */}
      <div className="shrink-0 px-4 py-3 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BranchesOutlined className="text-indigo-500" />
            <div className="text-[12px]">
              {selectedReview && (
                <>
                  <span className="text-gray-500">分支：</span>
                  <Tag color="blue" className="!text-[11px]">{selectedReview.workBranch}</Tag>
                  <span className="text-gray-400 mx-1">→</span>
                  <Tag color="green" className="!text-[11px]">{selectedReview.baseBranch}</Tag>
                </>
              )}
            </div>
            {selectedReview && (
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-green-600">
                  <PlusOutlined className="text-[9px]" /> {selectedReview.summary.totalAdditions}
                </span>
                <span className="text-red-500">
                  <MinusOutlined className="text-[9px]" /> {selectedReview.summary.totalDeletions}
                </span>
                <span className="text-gray-400">
                  {selectedReview.summary.filesChanged} 文件
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Select
              size="small"
              value={mergeStrategy}
              onChange={setMergeStrategy}
              options={[
                { value: 'squash', label: 'Squash Merge' },
                { value: 'merge', label: 'Merge Commit' },
                { value: 'rebase', label: 'Rebase' },
              ]}
              className="w-[140px]"
            />
            <Button
              type="primary"
              size="small"
              icon={<MergeCellsOutlined />}
              onClick={handleMerge}
              loading={merging}
              disabled={!selectedReview}
            >
              Approve & Merge
            </Button>
            <Button
              danger
              size="small"
              icon={<CloseCircleOutlined />}
              onClick={handleDiscard}
              disabled={!selectedReview}
            >
              Discard
            </Button>
          </div>
        </div>
      </div>

      {/* 主体：文件列表 + Diff 内容 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：文件树 */}
        <div className="w-[240px] shrink-0 border-r border-gray-100 overflow-y-auto bg-white">
          <div className="px-3 py-2 text-[11px] font-medium text-gray-500 uppercase tracking-wider border-b border-gray-50">
            Changed Files
          </div>
          {selectedReview?.files.map(file => {
            const config = fileStatusConfig[file.status]
            const isActive = selectedFile === file.path
            return (
              <div
                key={file.path}
                className={`px-3 py-2 cursor-pointer border-b border-gray-50 transition-colors ${
                  isActive ? 'bg-indigo-50 border-l-2 border-l-indigo-400' : 'hover:bg-gray-50'
                }`}
                onClick={() => setSelectedFile(file.path)}
              >
                <div className="flex items-center gap-2">
                  <span style={{ color: config.color }}>{config.icon}</span>
                  <span className="text-[11px] text-gray-700 truncate flex-1" title={file.path}>
                    {file.path.split('/').pop()}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 ml-5">
                  <span className="text-[10px] text-gray-400 truncate">{file.path}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 ml-5">
                  {file.additions > 0 && (
                    <span className="text-[10px] text-green-600">+{file.additions}</span>
                  )}
                  {file.deletions > 0 && (
                    <span className="text-[10px] text-red-500">-{file.deletions}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 右侧：Diff 内容 */}
        <div className="flex-1 overflow-y-auto bg-white">
          {currentFileDiff ? (
            <DiffContent fileDiff={currentFileDiff} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-[12px]">
              ← 选择文件查看 Diff
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════ Diff 内容渲染 ═══════════════

function DiffContent({ fileDiff }: { fileDiff: FileDiff }) {
  const config = fileStatusConfig[fileDiff.status]

  return (
    <div className="min-w-[600px]">
      {/* 文件头 */}
      <div className="sticky top-0 z-10 px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
        <Tag color={config.color} style={{ background: config.bgColor, borderColor: config.color }}>
          {config.label}
        </Tag>
        <span className="text-[12px] font-mono text-gray-700">{fileDiff.path}</span>
        <span className="text-[11px] text-gray-400 ml-auto">
          <span className="text-green-600">+{fileDiff.additions}</span>
          {' / '}
          <span className="text-red-500">-{fileDiff.deletions}</span>
        </span>
      </div>

      {/* Hunks */}
      {fileDiff.hunks.map((hunk, hunkIdx) => (
        <div key={hunkIdx} className="border-b border-gray-100">
          {/* Hunk header */}
          <div className="px-4 py-1 bg-blue-50/50 text-[11px] font-mono text-blue-600 border-b border-blue-100/50">
            {hunk.header}
          </div>
          {/* Lines */}
          <div className="font-mono text-[11px] leading-[20px]">
            {hunk.lines.map((line, lineIdx) => (
              <DiffLineRow key={lineIdx} line={line} />
            ))}
          </div>
        </div>
      ))}

      {fileDiff.hunks.length === 0 && (
        <div className="p-8 text-center text-gray-400 text-[12px]">
          无差异内容（可能是权限或元数据变更）
        </div>
      )}
    </div>
  )
}

function DiffLineRow({ line }: { line: DiffLine }) {
  const bgColor = line.type === 'add' ? 'bg-green-50' : line.type === 'delete' ? 'bg-red-50' : ''
  const textColor = line.type === 'add' ? 'text-green-800' : line.type === 'delete' ? 'text-red-800' : 'text-gray-700'
  const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '
  const lineNoColor = line.type === 'add' ? 'text-green-400' : line.type === 'delete' ? 'text-red-400' : 'text-gray-300'

  return (
    <div className={`flex ${bgColor} hover:brightness-95 transition-all`}>
      {/* 旧行号 */}
      <div className={`w-[48px] shrink-0 text-right pr-2 select-none ${lineNoColor} border-r border-gray-100`}>
        {line.oldLineNo ?? ''}
      </div>
      {/* 新行号 */}
      <div className={`w-[48px] shrink-0 text-right pr-2 select-none ${lineNoColor} border-r border-gray-100`}>
        {line.newLineNo ?? ''}
      </div>
      {/* 前缀 */}
      <div className={`w-[20px] shrink-0 text-center select-none ${textColor} font-bold`}>
        {prefix}
      </div>
      {/* 内容 */}
      <div className={`flex-1 px-2 ${textColor} whitespace-pre overflow-x-auto`}>
        {line.content}
      </div>
    </div>
  )
}
