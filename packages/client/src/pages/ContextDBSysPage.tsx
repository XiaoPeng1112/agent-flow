import { useState, useEffect, useCallback } from 'react'
import { Button, Input, Empty, Popconfirm, Space, App, Tag, Card, Spin, Alert } from 'antd'
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, FileTextOutlined,
  ReloadOutlined, EditOutlined, LockOutlined,
} from '@ant-design/icons'
import { contextDBApi } from '../api'
import { shouldUseDemoMode } from '../demo/mockData'

interface ContextFile {
  filename: string
  level: string
  scopeId: string
  size: number
}

/**
 * ContextDBSysPage — SYS 层全局规则编辑页面
 * 
 * 管理全局系统上下文（编码规范、安全规则、输出格式、Agent 行为准则等）
 * 这些规则会注入到所有 Agent 的 prompt 中
 * 
 * 默认只读模式，点击右上方"编辑"按钮进入编辑模式
 */
export default function ContextDBSysPage() {
  const [files, setFiles] = useState<ContextFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [newFilename, setNewFilename] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const { message } = App.useApp()

  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const { files: fileList } = await contextDBApi.listFiles('SYS', 'global')
      setFiles(fileList || [])
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadFiles() }, [loadFiles])

  const handleSelectFile = async (filename: string) => {
    setSelectedFile(filename)
    setEditing(false)
    try {
      const { content } = await contextDBApi.getFile('SYS', 'global', filename)
      setFileContent(content)
      setOriginalContent(content)
    } catch {
      setFileContent('')
      setOriginalContent('')
    }
  }

  const handleSave = async () => {
    if (!selectedFile) return
    setSaving(true)
    try {
      await contextDBApi.upsertFile('SYS', 'global', selectedFile, fileContent)
      setOriginalContent(fileContent)
      setEditing(false)
      message.success(`已保存 ${selectedFile}`)
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async () => {
    if (!newFilename.trim()) return
    const filename = newFilename.endsWith('.md') ? newFilename : `${newFilename}.md`
    try {
      await contextDBApi.upsertFile('SYS', 'global', filename, `# ${filename.replace('.md', '')}\n\n在此编写全局规则...\n`)
      setNewFilename('')
      setIsCreating(false)
      await loadFiles()
      await handleSelectFile(filename)
      setEditing(true)
      message.success(`已创建 ${filename}`)
    } catch (err: any) {
      message.error(`创建失败: ${err.message}`)
    }
  }

  const handleDelete = async (filename: string) => {
    try {
      await contextDBApi.deleteFile('SYS', 'global', filename)
      if (selectedFile === filename) {
        setSelectedFile(null)
        setFileContent('')
        setEditing(false)
      }
      await loadFiles()
      message.success(`已删除 ${filename}`)
    } catch (err: any) {
      message.error(`删除失败: ${err.message}`)
    }
  }

  const handleCancelEdit = () => {
    setFileContent(originalContent)
    setEditing(false)
  }

  const hasUnsavedChanges = fileContent !== originalContent

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#f5f6fa]">
      {/* 标题区域 */}
      <div className="px-8 py-5 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-800 m-0">Context DB · SYS 层</h2>
          <Tag color="purple">全局规则</Tag>
        </div>
        <p className="text-sm text-gray-500 mt-1 mb-0">
          管理系统级上下文规则，这些规则会注入到所有 Agent 的 prompt 中。包括编码规范、安全规则、输出格式、行为准则等。
        </p>
        {shouldUseDemoMode() && (
          <Alert
            type="info"
            showIcon
            className="!mt-4"
            message="Demo 模式下仅展示示例规则"
            description="这里的内容用于让新用户理解 SYS 层上下文会存什么，不会真的写回后端。"
          />
        )}
      </div>

      {/* 主体区域 */}
      <div className="flex-1 flex gap-4 overflow-hidden p-6">
        {/* 左侧文件列表 */}
        <Card
          size="small"
          className="w-[220px] shrink-0 !rounded-xl !shadow-sm"
          styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' } }}
          title={<span className="text-xs font-medium text-gray-500 uppercase">文件列表</span>}
          extra={
            <Space size={4}>
              <Button type="text" size="small" icon={<ReloadOutlined />} onClick={loadFiles} />
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => setIsCreating(true)} />
            </Space>
          }
        >
          <div className="flex-1 flex flex-col overflow-hidden p-2">
            {isCreating && (
              <div className="mb-2 flex gap-1">
                <Input
                  size="small"
                  placeholder="filename.md"
                  value={newFilename}
                  onChange={(e) => setNewFilename(e.target.value)}
                  onPressEnter={handleCreate}
                />
                <Button size="small" type="primary" onClick={handleCreate}>OK</Button>
                <Button size="small" onClick={() => { setIsCreating(false); setNewFilename('') }}>✕</Button>
              </div>
            )}

            {loading ? (
              <div className="flex-1 flex items-center justify-center"><Spin size="small" /></div>
            ) : files.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无规则文件" className="!my-4" />
            ) : (
              <div className="flex-1 overflow-y-auto space-y-0.5">
                {files.map((f) => (
                  <div
                    key={f.filename}
                    onClick={() => handleSelectFile(f.filename)}
                    className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                      selectedFile === f.filename
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <FileTextOutlined className="text-xs" />
                    <span className="flex-1 text-xs truncate">{f.filename}</span>
                    <Popconfirm
                      title="确定删除？"
                      onConfirm={(e) => { e?.stopPropagation(); handleDelete(f.filename) }}
                      onCancel={(e) => e?.stopPropagation()}
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                        className="!text-gray-300 hover:!text-red-500 opacity-0 group-hover:opacity-100"
                      />
                    </Popconfirm>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* 右侧内容区 */}
        <Card
          size="small"
          className="flex-1 !rounded-xl !shadow-sm overflow-hidden"
          styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' } }}
          title={
            selectedFile ? (
              <div className="flex items-center gap-2">
                <FileTextOutlined className="text-indigo-500" />
                <span className="text-sm font-medium text-gray-700">{selectedFile}</span>
                {editing ? (
                  <Tag color="orange" className="!text-[10px] !leading-tight !ml-1">编辑中</Tag>
                ) : (
                  <Tag color="default" className="!text-[10px] !leading-tight !ml-1"><LockOutlined className="mr-0.5" />只读</Tag>
                )}
                {hasUnsavedChanges && (
                  <span className="text-xs text-orange-500 ml-1">● 未保存</span>
                )}
              </div>
            ) : (
              <span className="text-sm text-gray-400">选择文件查看</span>
            )
          }
          extra={
            selectedFile && (
              <Space size={8}>
                {!editing ? (
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setEditing(true)}
                  >
                    编辑
                  </Button>
                ) : (
                  <>
                    <Button size="small" onClick={handleCancelEdit}>取消</Button>
                    <Button
                      type="primary"
                      size="small"
                      icon={<SaveOutlined />}
                      loading={saving}
                      disabled={!hasUnsavedChanges}
                      onClick={handleSave}
                    >
                      保存
                    </Button>
                  </>
                )}
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => handleSelectFile(selectedFile)}
                />
              </Space>
            )
          }
        >
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedFile ? (
              editing ? (
                <Input.TextArea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="!flex-1 !font-mono !text-[13px] !resize-none !rounded-none !border-0 !border-t !border-gray-100"
                  style={{ minHeight: 0 }}
                  spellCheck={false}
                />
              ) : (
                <pre className="flex-1 overflow-auto m-0 px-4 py-3 text-[13px] font-mono text-gray-700 leading-relaxed whitespace-pre-wrap border-t border-gray-100 bg-gray-50/50">
                  {fileContent || '(空文件)'}
                </pre>
              )
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span className="text-gray-400">选择左侧文件查看内容</span>}
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
