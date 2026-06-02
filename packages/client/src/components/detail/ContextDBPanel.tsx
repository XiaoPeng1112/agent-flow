import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Input, Tag, Empty, Popconfirm, Space, Tooltip, Tabs, App, Select } from 'antd'
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, FileTextOutlined,
  DatabaseOutlined, ReloadOutlined, EyeOutlined,
  LockOutlined, EditOutlined, LinkOutlined,
} from '@ant-design/icons'
import { contextDBApi } from '../../api'

/**
 * ContextDBPanel — Run 级上下文管理面板
 * 
 * 设计原则（闭环方案）：
 * - SYS / L0 / L1 层：只读预览（这些由全局设置 / 项目 Settings / 模板编辑器管理）
 * - L2 层：可编辑（每个 Run 节点的精确上下文，可新增/编辑/删除）
 * - 装配预览：一键查看 Agent 实际收到的完整上下文（全层合并后的结果）
 */

interface ContextFile {
  filename: string
  level: string
  scopeId: string
  size: number
  nodeName?: string
}

interface Props {
  projectId?: string
  templateId?: string
  nodeId?: string
  runId?: string
}

const LEVEL_CONFIG = {
  SYS: { label: '系统级 (SYS)', color: '#6366f1', description: '全局规则、编码规范、安全策略', editable: false },
  L0: { label: '项目级 (L0)', color: '#059669', description: '项目架构、技术栈、业务背景', editable: false },
  L1: { label: '模板级 (L1)', color: '#d97706', description: '工作流模板的阶段说明', editable: false },
  L2: { label: '节点级 (L2)', color: '#dc2626', description: '当前节点的精确上下文（可编辑）', editable: true },
}

/** 节点类型中文映射 */
const NODE_NAME_LABELS: Record<string, string> = {
  specify: '需求定义',
  design: '架构设计',
  task_split: '任务拆分',
  implement: '编码实现',
  review: '代码审查',
  test: '测试验证',
  deliver: '交付部署',
}

function getNodeLabel(nodeName: string): string {
  const label = NODE_NAME_LABELS[nodeName]
  return label ? `${nodeName}（${label}）` : nodeName
}

export function ContextDBPanel({ projectId, templateId, nodeId, runId }: Props) {
  const [activeLevel, setActiveLevel] = useState<string>('L2')
  const [files, setFiles] = useState<ContextFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [newFilename, setNewFilename] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [assembledPreview, setAssembledPreview] = useState<string | null>(null)
  const [selectedNodeFilter, setSelectedNodeFilter] = useState<string>('all')
  const { message } = App.useApp()

  const isEditable = LEVEL_CONFIG[activeLevel as keyof typeof LEVEL_CONFIG]?.editable ?? false

  const getScopeId = useCallback((level: string) => {
    switch (level) {
      case 'SYS': return 'global'
      case 'L0': return projectId || 'default'
      case 'L1': return templateId || 'default'
      case 'L2': return nodeId || 'default'
      default: return 'global'
    }
  }, [projectId, templateId, nodeId])

  // 加载文件列表
  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      if (activeLevel === 'L2' && runId) {
        // L2 层使用批量 API 按 runId 加载所有节点文件
        const { files: fileList } = await contextDBApi.listL2ByRun(runId)
        setFiles(fileList || [])
      } else {
        const scopeId = getScopeId(activeLevel)
        const { files: fileList } = await contextDBApi.listFiles(activeLevel, scopeId)
        setFiles(fileList || [])
      }
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [activeLevel, getScopeId, runId])

  useEffect(() => { loadFiles() }, [loadFiles])

  // 获取节点列表（从 L2 文件的 nodeName 提取）
  const nodeNames = [...new Set(files.filter(f => f.nodeName).map(f => f.nodeName!))]
  
  // 过滤后的文件列表
  const filteredFiles = selectedNodeFilter === 'all'
    ? files
    : files.filter(f => f.nodeName === selectedNodeFilter)

  // 选择文件并加载内容
  const handleSelectFile = async (file: ContextFile) => {
    setSelectedFile(file.filename)
    setSelectedScopeId(file.scopeId)
    setIsCreating(false)
    try {
      const { content } = await contextDBApi.getFile(activeLevel, file.scopeId, file.filename)
      setFileContent(content)
    } catch {
      setFileContent('')
      message.error('读取文件失败')
    }
  }

  // 保存文件（仅 L2）
  const handleSave = async () => {
    if (!isEditable) return
    const filename = isCreating ? newFilename.trim() : selectedFile
    if (!filename) {
      message.warning('请输入文件名')
      return
    }
    const finalName = filename.endsWith('.md') ? filename : `${filename}.md`
    const scopeId = isCreating
      ? (selectedNodeFilter !== 'all' && runId ? `${runId}_${selectedNodeFilter}` : (selectedScopeId || getScopeId(activeLevel)))
      : (selectedScopeId || getScopeId(activeLevel))
    try {
      await contextDBApi.upsertFile(activeLevel, scopeId, finalName, fileContent)
      message.success('保存成功')
      setIsCreating(false)
      setSelectedFile(finalName)
      setSelectedScopeId(scopeId)
      setNewFilename('')
      loadFiles()
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`)
    }
  }

  // 删除文件（仅 L2）
  const handleDelete = async (file: ContextFile) => {
    if (!isEditable) return
    try {
      await contextDBApi.deleteFile(activeLevel, file.scopeId, file.filename)
      message.success('已删除')
      if (selectedFile === file.filename && selectedScopeId === file.scopeId) {
        setSelectedFile(null)
        setSelectedScopeId(null)
        setFileContent('')
      }
      loadFiles()
    } catch (err: any) {
      message.error(`删除失败: ${err.message}`)
    }
  }

  // 装配预览
  const handleAssemblePreview = async () => {
    try {
      const assembleNodeId = selectedScopeId || (selectedNodeFilter !== 'all' && runId ? `${runId}_${selectedNodeFilter}` : nodeId)
      const { formatted, totalLayers } = await contextDBApi.assemble({
        projectId,
        templateId,
        nodeId: assembleNodeId,
      })
      setAssembledPreview(formatted || '(无上下文文件)')
      message.info(`装配完成: ${totalLayers} 层上下文`)
    } catch (err: any) {
      message.error(`装配预览失败: ${err.message}`)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DatabaseOutlined className="text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">Context DB</span>
          <Tag color="purple" className="!text-[10px] !leading-tight !py-0">
            Run 上下文视图
          </Tag>
        </div>
        <Space size="small">
          <Tooltip title="装配预览 — 查看 Agent 执行时收到的完整上下文（SYS → L0 → L1 → L2 自动合并）">
            <Button size="small" icon={<EyeOutlined />} onClick={handleAssemblePreview}>
              装配预览
            </Button>
          </Tooltip>
          <Button size="small" icon={<ReloadOutlined />} onClick={loadFiles}>刷新</Button>
        </Space>
      </div>

      {/* 层级 Tabs */}
      <Tabs
        activeKey={activeLevel}
        onChange={(key) => { setActiveLevel(key); setSelectedFile(null); setSelectedScopeId(null); setFileContent(''); setIsCreating(false); setSelectedNodeFilter('all') }}
        size="small"
        className="px-4"
        items={Object.entries(LEVEL_CONFIG).map(([key, cfg]) => ({
          key,
          label: (
            <span className="text-[11px] flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
              {cfg.label}
              {!cfg.editable && <LockOutlined className="text-[9px] text-gray-300" />}
            </span>
          ),
        }))}
      />

      {/* 当前层级描述 */}
      <ContextLevelBar activeLevel={activeLevel} isEditable={isEditable} projectId={projectId} />

      {/* L2 节点筛选器 */}
      {activeLevel === 'L2' && nodeNames.length > 0 && (
        <div className="px-4 py-1.5 border-b border-gray-50 flex items-center gap-2">
          <span className="text-[11px] text-gray-400">节点筛选:</span>
          <Select
            size="small"
            value={selectedNodeFilter}
            onChange={setSelectedNodeFilter}
            className="!w-52 !text-[11px]"
            options={[
              { value: 'all', label: '全部节点' },
              ...nodeNames.map(name => ({ value: name, label: getNodeLabel(name) })),
            ]}
          />
          <span className="text-[10px] text-gray-300">
            共 {filteredFiles.length} 个文件
          </span>
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧文件列表 */}
        <div className="w-48 border-r border-gray-100 flex flex-col">
          {isEditable && (
            <div className="p-2 border-b border-gray-50">
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => { setIsCreating(true); setSelectedFile(null); setSelectedScopeId(null); setFileContent(''); setNewFilename('') }}
                block
                className="!text-[11px]"
              >
                新建 L2 文件
              </Button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            {filteredFiles.length === 0 && !loading && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span className="text-[11px] text-gray-300">
                    {isEditable ? '暂无节点上下文，点击"新建"添加' : '此层级暂无文件'}
                  </span>
                }
                className="mt-8"
              />
            )}
            {filteredFiles.map((f) => (
              <div
                key={`${f.scopeId}/${f.filename}`}
                className={`px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-50 border-b border-gray-50/50 ${
                  selectedFile === f.filename && selectedScopeId === f.scopeId ? 'bg-blue-50 border-l-2 border-l-blue-400' : ''
                }`}
                onClick={() => handleSelectFile(f)}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <FileTextOutlined className="text-gray-300 text-[10px] flex-shrink-0" />
                    <span className="text-[11px] text-gray-600 truncate">{f.filename}</span>
                  </div>
                  {f.nodeName && activeLevel === 'L2' && selectedNodeFilter === 'all' && (
                    <span className="text-[9px] text-gray-300 pl-4 truncate">{getNodeLabel(f.nodeName)}</span>
                  )}
                </div>
                {isEditable && (
                  <Popconfirm title="确定删除？" onConfirm={(e) => { e?.stopPropagation(); handleDelete(f) }}>
                    <DeleteOutlined
                      className="text-[10px] text-gray-300 hover:text-red-400 flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 右侧内容/编辑区 */}
        <div className="flex-1 flex flex-col">
          {assembledPreview !== null ? (
            // 装配预览
            <div className="flex-1 flex flex-col">
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between bg-indigo-50/50">
                <span className="text-[11px] font-medium text-indigo-600">
                  <EyeOutlined className="mr-1" />装配预览（Agent 执行时收到的完整 Context）
                </span>
                <Button size="small" type="text" onClick={() => setAssembledPreview(null)} className="!text-[11px]">关闭</Button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 bg-gray-900">
                <pre className="text-[11px] text-green-300 whitespace-pre-wrap font-mono leading-relaxed m-0">{assembledPreview}</pre>
              </div>
            </div>
          ) : selectedFile || isCreating ? (
            // 文件查看 / 编辑
            <div className="flex-1 flex flex-col">
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                {isCreating ? (
                  <Input
                    size="small"
                    value={newFilename}
                    onChange={(e) => setNewFilename(e.target.value)}
                    placeholder="文件名（如 node-context、requirements）"
                    suffix=".md"
                    className="!w-60 !text-[11px]"
                    autoFocus
                  />
                ) : (
                  <div className="flex items-center gap-1.5">
                    {isEditable ? <EditOutlined className="text-[10px] text-green-500" /> : <LockOutlined className="text-[10px] text-gray-300" />}
                    <span className="text-[12px] font-medium text-gray-700 font-mono">{selectedFile}</span>
                    {!isEditable && <Tag className="!text-[9px] !leading-tight !py-0 !ml-2">只读</Tag>}
                  </div>
                )}
                {isEditable && (
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
                )}
              </div>
              <div className="flex-1 p-2">
                <Input.TextArea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  readOnly={!isEditable}
                  className={`!h-full !text-[11px] !font-mono !resize-none ${
                    !isEditable ? '!bg-gray-50 !cursor-default' : ''
                  }`}
                  placeholder={isEditable
                    ? '输入节点上下文（Markdown 格式）...\n\n例如：\n# 当前节点职责\n负责实现 XX 模块的单元测试...'
                    : ''
                  }
                />
              </div>
            </div>
          ) : (
            // 空状态 + 引导
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={null}
                />
                <div className="text-[12px] text-gray-400 mt-2">
                  {isEditable
                    ? '选择已有文件或新建 L2 节点上下文'
                    : '选择文件查看内容（只读）'}
                </div>
                <div className="text-[10px] text-gray-300 mt-3 max-w-[260px] mx-auto leading-relaxed">
                  {isEditable
                    ? 'L2 上下文仅作用于当前节点，可以描述具体任务指令、约束条件等'
                    : '此层级在对应的管理页面编辑：SYS → 全局设置、L0 → 项目 Settings、L1 → 模板编辑器'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 层级描述条 — 带跳转链接 */
function ContextLevelBar({ activeLevel, isEditable, projectId }: { activeLevel: string; isEditable: boolean; projectId?: string }) {
  const navigate = useNavigate()

  const getEditLink = (level: string) => {
    if (level === 'SYS') return '/context-db/sys'
    if (level === 'L0' && projectId) return `/projects/${projectId}/settings`
    if (level === 'L1') return '/context-db/l1'
    return null
  }

  const editLink = getEditLink(activeLevel)

  return (
    <div className="px-4 py-1.5 text-[11px] border-b border-gray-50 flex items-center justify-between">
      <span className="text-gray-400">{LEVEL_CONFIG[activeLevel as keyof typeof LEVEL_CONFIG]?.description}</span>
      <div className="flex items-center gap-2">
        {!isEditable && editLink && (
          <Button
            type="link"
            size="small"
            icon={<LinkOutlined />}
            className="!text-[10px] !h-auto !p-0"
            onClick={() => navigate(editLink)}
          >
            前往编辑
          </Button>
        )}
        {!isEditable && !editLink && (
          <Tag color="default" className="!text-[9px] !leading-tight !py-0">
            <LockOutlined className="mr-0.5" />只读
          </Tag>
        )}
        {isEditable && (
          <Tag color="green" className="!text-[9px] !leading-tight !py-0">
            <EditOutlined className="mr-0.5" />可编辑 — 节点级上下文
          </Tag>
        )}
      </div>
    </div>
  )
}
