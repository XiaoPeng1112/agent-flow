import { useState, useEffect, useCallback } from 'react'
import {
  Form, Input, Button, Divider, App, Space, Tag, Statistic,
  Row, Col, Slider, Popconfirm, Radio,
  Collapse, Badge, Typography, Spin, Alert, Empty,
} from 'antd'
import {
  SaveOutlined, ThunderboltOutlined, DatabaseOutlined,
  CloudSyncOutlined, DeleteOutlined, ExportOutlined,
  EyeOutlined, WarningOutlined,
  ReloadOutlined, CheckCircleOutlined, ClockCircleOutlined,
  BarChartOutlined, FileTextOutlined, CodeOutlined,
  PlusOutlined, FolderOpenOutlined, EditOutlined,
  BranchesOutlined, MergeCellsOutlined,
} from '@ant-design/icons'
import { projectApi, syncApi, contextDBApi, diffReviewApi } from '../../api'
import { useAppStore } from '../../store/appStore'
import type { Project } from '../../types'

const { Text } = Typography

interface Props {
  project: Project
}

// ═══════════════ 子组件：Run Insights ═══════════════

function RunInsightsSection({ project }: { project: Project }) {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const loadStats = useCallback(async () => {
    setLoading(true)
    try {
      const data = await projectApi.getStats(project.id)
      setStats(data)
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => { loadStats() }, [loadStats])

  if (loading && !stats) return <Spin size="small" />
  if (!stats) return <Text type="secondary">暂无运行数据</Text>

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Statistic title="总运行" value={stats.totalRuns} prefix={<ThunderboltOutlined />} />
        </Col>
        <Col span={6}>
          <Statistic
            title="成功率"
            value={stats.successRate}
            suffix="%"
            valueStyle={{ color: stats.successRate >= 80 ? '#3f8600' : stats.successRate >= 50 ? '#d48806' : '#cf1322' }}
            prefix={<CheckCircleOutlined />}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="进行中"
            value={stats.runningRuns}
            prefix={<ClockCircleOutlined />}
            valueStyle={{ color: stats.runningRuns > 0 ? '#1677ff' : undefined }}
          />
        </Col>
        <Col span={6}>
          <Statistic
            title="平均耗时"
            value={stats.avgDuration > 0 ? `${Math.round(stats.avgDuration / 1000)}s` : '-'}
            prefix={<BarChartOutlined />}
          />
        </Col>
      </Row>

      <Divider className="!my-3" />

      <Row gutter={[16, 8]}>
        <Col span={8}>
          <div className="flex items-center justify-between">
            <Text type="secondary" className="text-xs">完成</Text>
            <Text strong className="text-xs">{stats.completedRuns}</Text>
          </div>
        </Col>
        <Col span={8}>
          <div className="flex items-center justify-between">
            <Text type="secondary" className="text-xs">失败</Text>
            <Text strong type={stats.failedRuns > 0 ? 'danger' : undefined} className="text-xs">{stats.failedRuns}</Text>
          </div>
        </Col>
        <Col span={8}>
          <div className="flex items-center justify-between">
            <Text type="secondary" className="text-xs">节点完成率</Text>
            <Text strong className="text-xs">{stats.totalNodes > 0 ? Math.round((stats.completedNodes / stats.totalNodes) * 100) : 0}%</Text>
          </div>
        </Col>
      </Row>

      {stats.lastRunAt && (
        <div className="mt-3 text-[11px] text-gray-400">
          最近运行: {new Date(stats.lastRunAt).toLocaleString('zh-CN')}
        </div>
      )}

      <div className="mt-3">
        <Button size="small" icon={<ReloadOutlined />} onClick={loadStats} loading={loading}>刷新</Button>
      </div>
    </div>
  )
}

// ═══════════════ 子组件：Context Engine（L0 完整编辑器） ═══════════════

function ContextEngineSection({ project }: { project: Project }) {
  const [l0Files, setL0Files] = useState<Array<{ filename: string; size: number }>>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [newFilename, setNewFilename] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const { message } = App.useApp()

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const { files } = await contextDBApi.listFiles('L0', project.id)
      setL0Files(files || [])
    } catch {
      setL0Files([])
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => { loadFiles() }, [loadFiles])

  const handleSelectFile = async (filename: string) => {
    setSelectedFile(filename)
    setIsCreating(false)
    try {
      const { content } = await contextDBApi.getFile('L0', project.id, filename)
      setFileContent(content)
    } catch {
      setFileContent('')
      message.error('读取失败')
    }
  }

  const handleSave = async () => {
    const filename = isCreating ? newFilename.trim() : selectedFile
    if (!filename) {
      message.warning('请输入文件名')
      return
    }
    // 自动补 .md 扩展名
    const finalName = filename.endsWith('.md') ? filename : `${filename}.md`
    setSaving(true)
    try {
      await contextDBApi.upsertFile('L0', project.id, finalName, fileContent)
      message.success('已保存')
      setIsCreating(false)
      setSelectedFile(finalName)
      setNewFilename('')
      loadFiles()
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (filename: string) => {
    try {
      await contextDBApi.deleteFile('L0', project.id, filename)
      message.success('已删除')
      if (selectedFile === filename) {
        setSelectedFile(null)
        setFileContent('')
      }
      loadFiles()
    } catch (err: any) {
      message.error(`删除失败: ${err.message}`)
    }
  }

  const handlePreview = async () => {
    setPreviewLoading(true)
    try {
      const data = await projectApi.getContextPreview(project.id)
      setPreview(data.formatted || '(无上下文)')
    } catch {
      setPreview('装配失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <div>
      {/* 说明 */}
      <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
        <div className="text-[11px] text-blue-600 leading-relaxed">
          <strong>这里管理的就是本项目的上下文信息</strong>（替代原来的"产品上下文"和"技术上下文"输入框）。
          每个 .md 文件的内容会在 Agent 执行时自动注入 Prompt。所有 Run 共享这些文件，无需逐个配置。
        </div>
        <div className="text-[10px] text-blue-500 mt-1">
          建议：创建 product.md（产品背景）和 technical.md（技术栈）来描述项目，
          也可以加 architecture.md、conventions.md 等更细粒度的文件。
        </div>
      </div>

      {/* 文件列表 + 编辑器 双栏布局 */}
      <div className="flex gap-3 min-h-[280px]">
        {/* 左栏：文件列表 */}
        <div className="w-[180px] flex-shrink-0 border border-gray-100 rounded-lg overflow-hidden flex flex-col">
          <div className="p-2 border-b border-gray-50 bg-gray-50/50">
            <Button
              type="dashed"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => { setIsCreating(true); setSelectedFile(null); setFileContent(''); setNewFilename('') }}
              block
              className="!text-[11px]"
            >
              新建上下文文件
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && l0Files.length === 0 && <div className="p-3 text-center"><Spin size="small" /></div>}
            {!loading && l0Files.length === 0 && (
              <div className="p-4 text-center">
                <FolderOpenOutlined className="text-xl text-gray-200 mb-1" />
                <div className="text-[10px] text-gray-300">暂无文件</div>
              </div>
            )}
            {l0Files.map((f) => (
              <div
                key={f.filename}
                className={`px-3 py-2 flex items-center justify-between cursor-pointer border-b border-gray-50/50 hover:bg-gray-50 transition-colors ${
                  selectedFile === f.filename ? 'bg-blue-50 border-l-2 !border-l-blue-400' : ''
                }`}
                onClick={() => handleSelectFile(f.filename)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileTextOutlined className="text-[10px] text-gray-300 flex-shrink-0" />
                  <span className="text-[11px] text-gray-600 truncate">{f.filename}</span>
                </div>
                <Popconfirm title="删除此文件？" onConfirm={(e) => { e?.stopPropagation(); handleDelete(f.filename) }}>
                  <DeleteOutlined
                    className="text-[10px] text-gray-200 hover:text-red-400 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>
              </div>
            ))}
          </div>
        </div>

        {/* 右栏：编辑器 */}
        <div className="flex-1 border border-gray-100 rounded-lg overflow-hidden flex flex-col">
          {(selectedFile || isCreating) ? (
            <>
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                {isCreating ? (
                  <Input
                    size="small"
                    value={newFilename}
                    onChange={(e) => setNewFilename(e.target.value)}
                    placeholder="文件名（如 product、technical）"
                    suffix=".md"
                    className="!w-52 !text-[11px]"
                    autoFocus
                  />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <EditOutlined className="text-[10px] text-gray-400" />
                    <span className="text-[12px] font-medium text-gray-700 font-mono">{selectedFile}</span>
                  </div>
                )}
                <Button
                  type="primary"
                  size="small"
                  icon={<SaveOutlined />}
                  onClick={handleSave}
                  loading={saving}
                  disabled={isCreating && !newFilename.trim()}
                  className="!text-[11px]"
                >
                  保存
                </Button>
              </div>
              <div className="flex-1 p-2">
                <Input.TextArea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="!h-full !text-[11px] !font-mono !resize-none !border-0 focus:!shadow-none"
                  placeholder={isCreating
                    ? '输入上下文内容（Markdown 格式）...\n\n例如：\n# 产品背景\n这是一个面向开发者的 AI 工作流平台...'
                    : '编辑上下文内容...'
                  }
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span className="text-[11px] text-gray-300">选择文件编辑，或新建上下文文件</span>}
              />
            </div>
          )}
        </div>
      </div>

      {/* 装配预览 */}
      <div className="mt-3 flex items-center gap-2">
        <Button size="small" icon={<EyeOutlined />} onClick={handlePreview} loading={previewLoading}>
          预览 Agent 实际收到的上下文
        </Button>
        {preview && (
          <Button size="small" type="text" onClick={() => setPreview(null)} className="!text-[11px]">关闭预览</Button>
        )}
      </div>

      {preview && (
        <div className="mt-2 p-3 bg-gray-900 rounded-lg max-h-[180px] overflow-auto">
          <pre className="text-[11px] text-green-300 whitespace-pre-wrap m-0 font-mono leading-relaxed">
            {preview.slice(0, 3000)}{preview.length > 3000 ? '\n... (truncated)' : ''}
          </pre>
        </div>
      )}
    </div>
  )
}

// ═══════════════ 子组件：默认运行模式 ═══════════════

function ExecutionModeSection({ project }: { project: Project }) {
  const [mode, setMode] = useState<'llm' | 'det' | 'hyb'>(project.defaultExecutionMode || 'llm')
  const [saving, setSaving] = useState(false)
  const { message } = App.useApp()

  const handleSave = async () => {
    setSaving(true)
    try {
      await projectApi.update(project.id, { defaultExecutionMode: mode })
      message.success('默认运行模式已保存')
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
        <Space direction="vertical" size={10}>
          <Radio value="llm">
            <div>
              <Text strong className="text-xs"><ThunderboltOutlined className="mr-1" />LLM 模式</Text>
              <div className="text-[11px] text-gray-500 ml-5">Agent 全权处理：自动推理、编码、调试、提交。适合需求明确的开发任务</div>
            </div>
          </Radio>
          <Radio value="det">
            <div>
              <Text strong className="text-xs"><CodeOutlined className="mr-1" />DET 确定性模式</Text>
              <div className="text-[11px] text-gray-500 ml-5">执行预定义脚本（如 yarn test、lint），无 AI 参与。适合构建、测试、部署等可重复流程</div>
            </div>
          </Radio>
          <Radio value="hyb">
            <div>
              <Text strong className="text-xs"><CodeOutlined className="mr-1 text-purple-500" />HYB 混合模式</Text>
              <div className="text-[11px] text-gray-500 ml-5">先执行脚本收集环境信息（如错误日志），再交给 Agent 分析处理。适合诊断、修复类任务</div>
            </div>
          </Radio>
        </Space>
      </Radio.Group>
      <div className="mt-3">
        <Button type="primary" size="small" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
      </div>
      <div className="text-[10px] text-gray-400 mt-2">
        默认模式应用于新 Run 中未指定模式的节点。每个模板/节点可单独覆盖。
      </div>
    </div>
  )
}

// ═══════════════ 子组件：代码合入方式 ═══════════════

function MergeModeSection({ project }: { project: Project }) {
  const [mergeMode, setMergeMode] = useState<'local' | 'pr'>(project.mergeMode || 'local')
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [locked, setLocked] = useState(false)
  const [detection, setDetection] = useState<{
    repoType: 'team' | 'personal'
    reason: string
    confidence: number
    collaboratorCount: number
    recentAuthors: string[]
  } | null>(null)
  const { message } = App.useApp()

  // 首次加载时只读检测（不自动设置）
  useEffect(() => {
    const detect = async () => {
      setDetecting(true)
      try {
        const res = await diffReviewApi.detectRepoType(project.id)
        setDetection({
          repoType: res.repoType,
          reason: res.reason,
          confidence: res.confidence,
          collaboratorCount: res.collaboratorCount,
          recentAuthors: res.recentAuthors,
        })
        // 如果是团队项目且当前为 local，提示但不强制切换
        if (res.repoType === 'team' && res.suggestedMergeMode === 'pr') {
          setLocked(true)
          setMergeMode('pr')
        }
      } catch {
        // 检测失败不影响使用
      } finally {
        setDetecting(false)
      }
    }
    detect()
  }, [project.id])

  const handleSave = async () => {
    setSaving(true)
    try {
      await projectApi.update(project.id, { mergeMode })
      message.success('合入方式已更新')
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleReDetect = async () => {
    setDetecting(true)
    try {
      const res = await diffReviewApi.detectRepoType(project.id)
      setDetection({
        repoType: res.repoType,
        reason: res.reason,
        confidence: res.confidence,
        collaboratorCount: res.collaboratorCount,
        recentAuthors: res.recentAuthors,
      })
      if (res.repoType === 'team' && res.suggestedMergeMode === 'pr') {
        setLocked(true)
        setMergeMode('pr')
      } else {
        setLocked(false)
      }
      message.success('检测完成')
    } catch (err: any) {
      message.error(`检测失败: ${err.message}`)
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div>
      {/* 检测结果 */}
      {detection && (
        <div className={`mb-4 p-3 rounded-lg border ${
          detection.repoType === 'team'
            ? 'bg-purple-50 border-purple-200'
            : 'bg-gray-50 border-gray-200'
        }`}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Tag color={detection.repoType === 'team' ? 'purple' : 'default'} className="!text-[11px]">
                {detection.repoType === 'team' ? '团队项目' : '个人项目'}
              </Tag>
              <span className="text-[10px] text-gray-400">
                置信度 {Math.round(detection.confidence * 100)}%
              </span>
            </div>
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={handleReDetect} loading={detecting} className="!text-[11px]">
              重新检测
            </Button>
          </div>
          <div className="text-[11px] text-gray-600">{detection.reason}</div>
          {detection.recentAuthors.length > 1 && (
            <div className="text-[10px] text-gray-400 mt-1">
              近期贡献者：{detection.recentAuthors.slice(0, 5).join('、')}{detection.recentAuthors.length > 5 ? ' ...' : ''}
            </div>
          )}
        </div>
      )}

      {detecting && !detection && <Spin size="small" className="mb-3" />}

      {/* 锁定提示 */}
      {locked && (
        <Alert
          type="info"
          showIcon
          message="团队项目必须使用 PR 模式"
          description="系统检测到此仓库为团队协作项目，代码合入必须通过 Pull Request 流程，以确保代码审查质量。"
          className="!mb-4 !text-[11px]"
        />
      )}

      <Radio.Group value={mergeMode} onChange={(e) => setMergeMode(e.target.value)} disabled={locked}>
        <Space direction="vertical" size={10}>
          <Radio value="local" disabled={locked}>
            <div>
              <Text strong className="text-xs"><MergeCellsOutlined className="mr-1" />本地合入</Text>
              <div className="text-[11px] text-gray-500 ml-5">Review 后直接在本地将工作分支合入 master。适合个人项目或无 CI 要求的场景</div>
            </div>
          </Radio>
          <Radio value="pr">
            <div>
              <Text strong className="text-xs"><BranchesOutlined className="mr-1 text-purple-500" />PR 模式（推荐团队项目）</Text>
              <div className="text-[11px] text-gray-500 ml-5">Review 后推送工作分支并创建 GitHub PR，由团队成员 Code Review 后合入。适合正式团队协作</div>
            </div>
          </Radio>
        </Space>
      </Radio.Group>
      {!locked && (
        <div className="mt-3">
          <Button type="primary" size="small" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
        </div>
      )}
      <div className="text-[10px] text-gray-400 mt-2">
        {locked
          ? '此设置已被锁定。如需更改，请联系仓库管理员调整项目配置。'
          : 'PR 模式需要项目已配置 GitHub OAuth 且对仓库有写入权限。'
        }
      </div>
    </div>
  )
}

// ═══════════════ 子组件：Data Management ═══════════════

function DataManagementSection({ project }: { project: Project }) {
  const [syncStatus, setSyncStatus] = useState<any>(null)
  const [syncing, setSyncing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { message } = App.useApp()

  const loadSyncStatus = useCallback(async () => {
    try {
      const data = await syncApi.getStatus()
      setSyncStatus(data)
    } catch {
      // silently fail
    }
  }, [])

  useEffect(() => { loadSyncStatus() }, [loadSyncStatus])

  const handlePush = async () => {
    setSyncing(true)
    try {
      const result = await syncApi.push()
      message.success(`推送完成: ${result.filesUpdated} 个文件`)
      loadSyncStatus()
    } catch (err: any) {
      message.error(`推送失败: ${err.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const handlePull = async () => {
    setSyncing(true)
    try {
      const result = await syncApi.pull()
      message.success(`拉取完成: ${result.filesRead} 个文件`)
      loadSyncStatus()
    } catch (err: any) {
      message.error(`拉取失败: ${err.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const data = await projectApi.exportData(project.id, { includeRuns: true, includeContext: true })
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.name}-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      message.success('已导出')
    } catch (err: any) {
      message.error(`导出失败: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      {/* 同步 */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <Space size={6}>
            <CloudSyncOutlined />
            <Text strong className="text-xs">GitHub 同步</Text>
          </Space>
          {syncStatus?.configured ? (
            <Badge status="success" text={<span className="text-xs">已连接</span>} />
          ) : (
            <Badge status="default" text={<span className="text-xs">未配置</span>} />
          )}
        </div>
        {syncStatus?.configured ? (
          <>
            <div className="text-[11px] text-gray-500 mb-2">
              仓库: <Text code className="!text-[11px]">{syncStatus.repoFullName}</Text>
            </div>
            {syncStatus.lastSyncAt && (
              <div className="text-[10px] text-gray-400 mb-2">
                上次同步: {new Date(syncStatus.lastSyncAt).toLocaleString('zh-CN')}
              </div>
            )}
            <Space size="small">
              <Button size="small" onClick={handlePush} loading={syncing}>推送</Button>
              <Button size="small" onClick={handlePull} loading={syncing}>拉取</Button>
            </Space>
          </>
        ) : (
          <Text type="secondary" className="text-[11px]">连接 GitHub 仓库后可跨设备同步项目数据与上下文文件</Text>
        )}
      </div>

      {/* 导出 */}
      <Button icon={<ExportOutlined />} onClick={handleExport} loading={exporting}>导出项目快照</Button>
      <div className="text-[11px] text-gray-400 mt-1">导出项目配置 + 运行历史为 JSON（可备份或迁移）</div>
    </div>
  )
}

// ═══════════════ 子组件：Danger Zone ═══════════════

function DangerZoneSection({ project }: { project: Project }) {
  const [cleaning, setCleaning] = useState(false)
  const [cleanDays, setCleanDays] = useState(30)
  const { message } = App.useApp()
  const setProjects = useAppStore((s) => s.setProjects)
  const projects = useAppStore((s) => s.projects)

  const handleCleanup = async () => {
    setCleaning(true)
    try {
      const result = await projectApi.cleanupRuns(project.id, { olderThanDays: cleanDays })
      message.success(`已清理 ${result.deleted} 个历史 Run`)
    } catch (err: any) {
      message.error(`清理失败: ${err.message}`)
    } finally {
      setCleaning(false)
    }
  }

  const handleDelete = async () => {
    try {
      await projectApi.delete(project.id)
      setProjects(projects.filter((p) => p.id !== project.id))
      message.success('项目已删除')
    } catch (err: any) {
      message.error(`删除失败: ${err.message}`)
    }
  }

  return (
    <div>
      <Alert message="以下操作不可撤销" type="warning" showIcon className="!mb-4" />

      <div className="mb-4 p-3 border border-orange-200 rounded-lg bg-orange-50/50">
        <div className="flex items-center justify-between mb-2">
          <div>
            <Text strong className="text-xs">清理历史 Runs</Text>
            <div className="text-[11px] text-gray-500">删除 {cleanDays} 天前已结束的 Run</div>
          </div>
          <Popconfirm
            title={`确认删除 ${cleanDays} 天前的 Runs？`}
            onConfirm={handleCleanup}
            okText="确认"
            okButtonProps={{ danger: true }}
          >
            <Button danger size="small" icon={<DeleteOutlined />} loading={cleaning}>清理</Button>
          </Popconfirm>
        </div>
        <Slider min={7} max={90} value={cleanDays} onChange={setCleanDays} marks={{ 7: '7天', 30: '30天', 90: '90天' }} />
      </div>

      <div className="p-3 border border-red-200 rounded-lg bg-red-50/50">
        <div className="flex items-center justify-between">
          <div>
            <Text strong type="danger" className="text-xs">删除项目</Text>
            <div className="text-[11px] text-gray-500">永久删除项目及所有关联数据</div>
          </div>
          <Popconfirm
            title={`永久删除 "${project.name}"？`}
            onConfirm={handleDelete}
            okText="确认删除"
            okButtonProps={{ danger: true }}
          >
            <Button danger type="primary" size="small" icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </div>
      </div>
    </div>
  )
}

// ═══════════════ 主组件 ═══════════════

export function SettingsPanel({ project }: Props) {
  const [saving, setSaving] = useState(false)
  const setProjects = useAppStore((s) => s.setProjects)
  const projects = useAppStore((s) => s.projects)
  const { message } = App.useApp()
  const [form] = Form.useForm()

  const handleSave = async () => {
    setSaving(true)
    try {
      const values = form.getFieldsValue()
      const res = await projectApi.update(project.id, {
        name: values.name,
        description: values.description,
        contextConfig: {
          repoUrl: values.repoUrl,
        },
      })
      setProjects(projects.map((p) => p.id === project.id ? { ...p, ...res.project } : p))
      message.success('已保存')
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const collapseItems = [
    {
      key: 'basic',
      label: (
        <Space>
          <FileTextOutlined />
          <span className="font-medium">基本信息</span>
        </Space>
      ),
      children: (
        <Form
          form={form}
          layout="vertical"
          size="small"
          initialValues={{
            name: project.name,
            description: project.description || '',
            path: project.path,
            repoUrl: project.contextConfig?.repoUrl || '',
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="项目名称">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="path" label="本地路径">
                <Input disabled className="!bg-gray-50 font-mono !text-gray-500" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="description" label="描述">
                <Input placeholder="项目简要描述" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="repoUrl" label="仓库地址">
                <Input placeholder="https://github.com/..." className="font-mono" />
              </Form.Item>
            </Col>
          </Row>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
        </Form>
      ),
    },
    {
      key: 'context',
      label: (
        <Space>
          <DatabaseOutlined />
          <span className="font-medium">Context Engine</span>
          <Tag color="purple" className="!ml-1 !text-[10px] !leading-tight !py-0">项目上下文</Tag>
        </Space>
      ),
      children: <ContextEngineSection project={project} />,
    },
    {
      key: 'insights',
      label: (
        <Space>
          <BarChartOutlined />
          <span className="font-medium">Run Insights</span>
          <Tag color="blue" className="!ml-1 !text-[10px] !leading-tight !py-0">统计</Tag>
        </Space>
      ),
      children: <RunInsightsSection project={project} />,
    },
    {
      key: 'mode',
      label: (
        <Space>
          <ThunderboltOutlined />
          <span className="font-medium">默认运行模式</span>
        </Space>
      ),
      children: <ExecutionModeSection project={project} />,
    },
    {
      key: 'merge-mode',
      label: (
        <Space>
          <BranchesOutlined />
          <span className="font-medium">代码合入方式</span>
          <Tag color="purple" className="!ml-1 !text-[10px] !leading-tight !py-0">PR / Local</Tag>
        </Space>
      ),
      children: <MergeModeSection project={project} />,
    },
    {
      key: 'data',
      label: (
        <Space>
          <CloudSyncOutlined />
          <span className="font-medium">Data Management</span>
          <Tag color="green" className="!ml-1 !text-[10px] !leading-tight !py-0">同步/备份</Tag>
        </Space>
      ),
      children: <DataManagementSection project={project} />,
    },
    {
      key: 'danger',
      label: (
        <Space>
          <WarningOutlined style={{ color: '#ff4d4f' }} />
          <span className="font-medium text-red-500">Danger Zone</span>
        </Space>
      ),
      children: <DangerZoneSection project={project} />,
    },
  ]

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-[15px] font-semibold text-gray-900 m-0">项目设置</h3>
        <Text type="secondary" className="text-[11px]">
          创建于 {new Date(project.createdAt).toLocaleDateString('zh-CN')}
        </Text>
      </div>

      {project.isDemo && (
        <Alert
          showIcon
          type="info"
          className="!mb-4"
          message="示范项目设置页"
          description="这里保留了真实项目里的配置结构，方便第一次访问的人理解系统能力；当前示范数据不会被保存。"
        />
      )}

      <Collapse
        items={collapseItems}
        defaultActiveKey={['basic', 'context']}
        className="!bg-transparent [&_.ant-collapse-item]:!border-gray-100 [&_.ant-collapse-content]:!border-gray-100"
        expandIconPosition="end"
      />
    </div>
  )
}
