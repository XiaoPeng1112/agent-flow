import { useState, useEffect, useCallback } from 'react'
import { Button, Input, Tabs, Tag, Empty, Popconfirm, message, Space, Tooltip } from 'antd'
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, FileTextOutlined,
  DatabaseOutlined, ReloadOutlined, EyeOutlined,
} from '@ant-design/icons'
import { contextDBApi } from '../../api'

/**
 * ContextDBPanel — 四层精准上下文数据库管理 UI
 * 
 * 管理 SYS/L0/L1/L2 四层上下文文件，支持：
 * - 查看/编辑/创建/删除上下文文件
 * - 按层级浏览
 * - 装配预览（查看 Agent 实际收到的完整上下文）
 */

interface ContextFile {
  filename: string
  level: string
  scopeId: string
  size: number
}

interface Props {
  projectId?: string
  templateId?: string
}

const LEVEL_CONFIG = {
  SYS: { label: '系统级 (SYS)', color: '#6366f1', description: '全局规则、编码规范、安全策略', scopeId: 'global' },
  L0: { label: '项目级 (L0)', color: '#059669', description: '项目架构、技术栈、业务背景' },
  L1: { label: '模板级 (L1)', color: '#d97706', description: '工作流模板的阶段说明' },
  L2: { label: '节点级 (L2)', color: '#dc2626', description: '单节点的精确上下文' },
}

export function ContextDBPanel({ projectId, templateId }: Props) {
  const [activeLevel, setActiveLevel] = useState<string>('SYS')
  const [files, setFiles] = useState<ContextFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [newFilename, setNewFilename] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<{ sys: number; l0: number; l1: number; l2: number; totalFiles: number } | null>(null)
  const [assembledPreview, setAssembledPreview] = useState<string | null>(null)

  const getScopeId = useCallback((level: string) => {
    switch (level) {
      case 'SYS': return 'global'
      case 'L0': return projectId || 'default'
      case 'L1': return templateId || 'default'
      case 'L2': return 'default'
      default: return 'global'
    }
  }, [projectId, templateId])

  // 加载文件列表
  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const scopeId = getScopeId(activeLevel)
      const { files: fileList } = await contextDBApi.listFiles(activeLevel, scopeId)
      setFiles(fileList)
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [activeLevel, getScopeId])

  // 加载统计
  const loadStats = useCallback(async () => {
    try {
      const data = await contextDBApi.getStats()
      setStats(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])
  useEffect(() => { loadStats() }, [loadStats])

  // 选择文件并加载内容
  const handleSelectFile = async (filename: string) => {
    setSelectedFile(filename)
    setIsCreating(false)
    try {
      const { content } = await contextDBApi.getFile(activeLevel, getScopeId(activeLevel), filename)
      setFileContent(content)
    } catch {
      setFileContent('')
      message.error('读取文件失败')
    }
  }

  // 保存文件
  const handleSave = async () => {
    const filename = isCreating ? newFilename.trim() : selectedFile
    if (!filename) {
      message.warning('请输入文件名')
      return
    }
    try {
      await contextDBApi.upsertFile(activeLevel, getScopeId(activeLevel), filename, fileContent)
      message.success('保存成功')
      setIsCreating(false)
      setSelectedFile(filename)
      setNewFilename('')
      loadFiles()
      loadStats()
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`)
    }
  }

  // 删除文件
  const handleDelete = async (filename: string) => {
    try {
      await contextDBApi.deleteFile(activeLevel, getScopeId(activeLevel), filename)
      message.success('已删除')
      if (selectedFile === filename) {
        setSelectedFile(null)
        setFileContent('')
      }
      loadFiles()
      loadStats()
    } catch (err: any) {
      message.error(`删除失败: ${err.message}`)
    }
  }

  // 装配预览
  const handleAssemblePreview = async () => {
    try {
      const { formatted, totalLayers } = await contextDBApi.assemble({
        projectId,
        templateId,
      })
      setAssembledPreview(formatted || '(无上下文文件)')
      message.info(`装配完成: ${totalLayers} 层上下文`)
    } catch (err: any) {
      message.error(`装配预览失败: ${err.message}`)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部统计 */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DatabaseOutlined className="text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">Context DB</span>
          {stats && (
            <Tag color="blue" className="text-[10px]">
              {stats.totalFiles} 文件
            </Tag>
          )}
        </div>
        <Space size="small">
          <Tooltip title="装配预览 — 查看 Agent 收到的完整上下文">
            <Button size="small" icon={<EyeOutlined />} onClick={handleAssemblePreview}>
              装配预览
            </Button>
          </Tooltip>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => { loadFiles(); loadStats() }}>
            刷新
          </Button>
        </Space>
      </div>

      {/* 层级 Tab */}
      <Tabs
        activeKey={activeLevel}
        onChange={(key) => { setActiveLevel(key); setSelectedFile(null); setFileContent(''); setIsCreating(false) }}
        size="small"
        className="px-4"
        items={Object.entries(LEVEL_CONFIG).map(([key, cfg]) => ({
          key,
          label: (
            <span className="text-[11px]">
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: cfg.color }} />
              {cfg.label}
              {stats && <span className="ml-1 text-gray-400">({stats[key.toLowerCase() as keyof typeof stats] ?? 0})</span>}
            </span>
          ),
        }))}
      />

      {/* 当前层级描述 */}
      <div className="px-4 py-1.5 text-[11px] text-gray-400 border-b border-gray-50">
        {LEVEL_CONFIG[activeLevel as keyof typeof LEVEL_CONFIG]?.description}
        {activeLevel !== 'SYS' && (
          <span className="ml-2 text-gray-300">
            Scope: {getScopeId(activeLevel)}
          </span>
        )}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧文件列表 */}
        <div className="w-48 border-r border-gray-100 flex flex-col">
          <div className="p-2 border-b border-gray-50">
            <Button
              type="dashed"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => { setIsCreating(true); setSelectedFile(null); setFileContent(''); setNewFilename('') }}
              block
              className="!text-[11px]"
            >
              新建文件
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {files.length === 0 && !loading && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span className="text-[11px] text-gray-300">暂无文件</span>}
                className="mt-8"
              />
            )}
            {files.map((f) => (
              <div
                key={f.filename}
                className={`px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-50 border-b border-gray-50/50 ${
                  selectedFile === f.filename ? 'bg-blue-50 border-l-2 border-l-blue-400' : ''
                }`}
                onClick={() => handleSelectFile(f.filename)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileTextOutlined className="text-gray-300 text-[10px] flex-shrink-0" />
                  <span className="text-[11px] text-gray-600 truncate">{f.filename}</span>
                </div>
                <Popconfirm title="确定删除？" onConfirm={(e) => { e?.stopPropagation(); handleDelete(f.filename) }}>
                  <DeleteOutlined
                    className="text-[10px] text-gray-300 hover:text-red-400 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧编辑区 */}
        <div className="flex-1 flex flex-col">
          {assembledPreview !== null ? (
            // 装配预览视图
            <div className="flex-1 flex flex-col">
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between bg-indigo-50/50">
                <span className="text-[11px] font-medium text-indigo-600">装配预览（Agent 收到的完整上下文）</span>
                <Button size="small" type="text" onClick={() => setAssembledPreview(null)} className="!text-[11px]">关闭</Button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <pre className="text-[11px] text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">{assembledPreview}</pre>
              </div>
            </div>
          ) : selectedFile || isCreating ? (
            // 编辑视图
            <div className="flex-1 flex flex-col">
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                {isCreating ? (
                  <Input
                    size="small"
                    value={newFilename}
                    onChange={(e) => setNewFilename(e.target.value)}
                    placeholder="文件名 (如: architecture.md)"
                    className="!w-60 !text-[11px]"
                    autoFocus
                  />
                ) : (
                  <span className="text-[12px] font-medium text-gray-700">{selectedFile}</span>
                )}
                <Button
                  type="primary"
                  size="small"
                  icon={<SaveOutlined />}
                  onClick={handleSave}
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
                  className="!h-full !text-[11px] !font-mono !resize-none"
                  placeholder="输入上下文内容（支持 Markdown）..."
                />
              </div>
            </div>
          ) : (
            // 空状态
            <div className="flex-1 flex items-center justify-center">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span className="text-[11px] text-gray-300">选择文件或新建上下文</span>}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
