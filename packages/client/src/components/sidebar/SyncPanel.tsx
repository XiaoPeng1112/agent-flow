import { useState, useEffect, useCallback } from 'react'
import { Button, Switch, Modal, Input, Select, App, Tooltip } from 'antd'
import {
  CloudSyncOutlined,
  CloudUploadOutlined,
  CloudDownloadOutlined,
  DisconnectOutlined,
  PlusOutlined,
  CheckCircleFilled,
  ExclamationCircleFilled,
  SyncOutlined,
} from '@ant-design/icons'
import { syncApi, authApi } from '../../api'

interface SyncStatus {
  configured: boolean
  repoFullName: string | null
  autoSync: boolean
  lastSyncAt: number | null
  lastCommitSha: string | null
  authenticated: boolean
  dirty: boolean
}

/**
 * 数据同步面板
 * 
 * 显示在 Sidebar 中，提供：
 * - 同步状态展示
 * - 手动 Push / Pull
 * - 配置同步仓库
 * - 自动同步开关
 */
export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [configModalOpen, setConfigModalOpen] = useState(false)
  const { message } = App.useApp()

  const loadStatus = useCallback(async () => {
    try {
      const s = await syncApi.getStatus()
      setStatus(s)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const handlePush = async () => {
    setPushing(true)
    try {
      const result = await syncApi.push()
      message.success(`推送成功，更新了 ${result.filesUpdated} 个文件`)
      await loadStatus()
    } catch (err: any) {
      message.error(`推送失败: ${err.message}`)
    } finally {
      setPushing(false)
    }
  }

  const handlePull = async () => {
    setPulling(true)
    try {
      const result = await syncApi.pull()
      if (result.conflicts.length > 0) {
        message.warning(`拉取完成，但有冲突: ${result.conflicts.join('; ')}`)
      } else {
        message.success(`拉取成功，读取了 ${result.filesRead} 个文件`)
      }
      await loadStatus()
    } catch (err: any) {
      message.error(`拉取失败: ${err.message}`)
    } finally {
      setPulling(false)
    }
  }

  const handleAutoSyncToggle = async (checked: boolean) => {
    try {
      await syncApi.setAutoSync(checked)
      await loadStatus()
    } catch (err: any) {
      message.error(`设置失败: ${err.message}`)
    }
  }

  const handleDisconnect = async () => {
    Modal.confirm({
      title: '断开同步',
      content: '断开后不会删除远端数据，但本地将不再自动同步。确认断开？',
      okText: '确认断开',
      okButtonProps: { danger: true },
      onOk: async () => {
        await syncApi.disconnect()
        await loadStatus()
        message.success('已断开同步')
      },
    })
  }

  if (!status) return null

  // 未登录 GitHub
  if (!status.authenticated) {
    return null // 不显示同步面板
  }

  // 未配置同步
  if (!status.configured) {
    return (
      <>
        <button
          onClick={() => setConfigModalOpen(true)}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
        >
          <CloudSyncOutlined className="text-[15px]" />
          <span>启用数据同步</span>
        </button>
        <SyncConfigModal
          open={configModalOpen}
          onClose={() => setConfigModalOpen(false)}
          onSuccess={loadStatus}
        />
      </>
    )
  }

  // 已配置同步 — 显示状态和操作按钮
  return (
    <div className="px-3 py-2">
      {/* 状态行 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <CloudSyncOutlined className="text-[13px]" />
          <span className="truncate max-w-[120px]" title={status.repoFullName || ''}>
            {status.repoFullName?.split('/')[1] || 'sync'}
          </span>
          {status.dirty ? (
            <Tooltip title="有未推送的变更">
              <ExclamationCircleFilled className="text-amber-400 text-[10px]" />
            </Tooltip>
          ) : (
            <Tooltip title="已同步">
              <CheckCircleFilled className="text-green-400 text-[10px]" />
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip title="自动同步">
            <Switch
              size="small"
              checked={status.autoSync}
              onChange={handleAutoSyncToggle}
              className="!min-w-[28px]"
            />
          </Tooltip>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-1.5">
        <Tooltip title="推送到远端">
          <button
            onClick={handlePush}
            disabled={pushing}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] text-slate-400 hover:text-white hover:bg-white/10 rounded transition-colors disabled:opacity-50"
          >
            {pushing ? <SyncOutlined spin className="text-[11px]" /> : <CloudUploadOutlined className="text-[11px]" />}
            <span>Push</span>
          </button>
        </Tooltip>
        <Tooltip title="从远端拉取">
          <button
            onClick={handlePull}
            disabled={pulling}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] text-slate-400 hover:text-white hover:bg-white/10 rounded transition-colors disabled:opacity-50"
          >
            {pulling ? <SyncOutlined spin className="text-[11px]" /> : <CloudDownloadOutlined className="text-[11px]" />}
            <span>Pull</span>
          </button>
        </Tooltip>
        <Tooltip title="断开同步">
          <button
            onClick={handleDisconnect}
            className="flex items-center justify-center px-1.5 py-1 text-[11px] text-slate-500 hover:text-red-400 hover:bg-white/5 rounded transition-colors"
          >
            <DisconnectOutlined className="text-[11px]" />
          </button>
        </Tooltip>
      </div>

      {/* 最后同步时间 */}
      {status.lastSyncAt && (
        <div className="text-[10px] text-slate-500 mt-1.5 text-center">
          上次同步: {new Date(status.lastSyncAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  )
}

// ═══════════════ 配置弹窗 ═══════════════

function SyncConfigModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [repos, setRepos] = useState<any[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState<string>('')
  const [newRepoName, setNewRepoName] = useState('agent-flow-data')
  const [creating, setCreating] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const [mode, setMode] = useState<'select' | 'create'>('select')
  const { message } = App.useApp()

  useEffect(() => {
    if (open) {
      setLoadingRepos(true)
      authApi.getRepos()
        .then((res) => {
          // 只展示私有仓库
          const privateRepos = res.repos.filter((r: any) => r.private)
          setRepos(privateRepos)
        })
        .catch(() => {})
        .finally(() => setLoadingRepos(false))
    }
  }, [open])

  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) return
    setCreating(true)
    try {
      const result = await syncApi.createRepo(newRepoName.trim())
      message.success(`仓库 ${result.full_name} 创建成功`)
      setSelectedRepo(result.full_name)
      // 刷新仓库列表
      const res = await authApi.getRepos()
      setRepos(res.repos.filter((r: any) => r.private))
      setMode('select')
    } catch (err: any) {
      message.error(`创建失败: ${err.message}`)
    } finally {
      setCreating(false)
    }
  }

  const handleConfigure = async () => {
    if (!selectedRepo) {
      message.warning('请选择一个仓库')
      return
    }
    setConfiguring(true)
    try {
      await syncApi.configure(selectedRepo, true)
      message.success('同步已配置')
      onSuccess()
      onClose()
    } catch (err: any) {
      message.error(`配置失败: ${err.message}`)
    } finally {
      setConfiguring(false)
    }
  }

  return (
    <Modal
      title="配置数据同步"
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
    >
      <div className="space-y-4 py-2">
        <p className="text-[13px] text-gray-500">
          将项目数据同步到你的 GitHub 私有仓库，实现多设备共享。数据包括项目列表、工作流模板、Run 记录等。
        </p>

        {mode === 'select' ? (
          <>
            <div>
              <label className="block text-[12px] text-gray-600 mb-1.5">选择已有的私有仓库</label>
              <Select
                className="w-full"
                placeholder="选择仓库..."
                value={selectedRepo || undefined}
                onChange={setSelectedRepo}
                loading={loadingRepos}
                options={repos.map((r) => ({
                  value: r.full_name,
                  label: (
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[12px]">{r.full_name}</span>
                      {r.description && <span className="text-[11px] text-gray-400">— {r.description}</span>}
                    </span>
                  ),
                }))}
                showSearch
                optionFilterProp="value"
              />
            </div>

            <div className="text-center text-[12px] text-gray-400">
              —— 或者 ——
            </div>

            <Button
              icon={<PlusOutlined />}
              onClick={() => setMode('create')}
              block
              type="dashed"
            >
              创建新的私有仓库
            </Button>
          </>
        ) : (
          <>
            <div>
              <label className="block text-[12px] text-gray-600 mb-1.5">新仓库名称</label>
              <Input
                value={newRepoName}
                onChange={(e) => setNewRepoName(e.target.value)}
                placeholder="agent-flow-data"
                addonBefore="your-username/"
                className="font-mono"
              />
              <p className="text-[11px] text-gray-400 mt-1">将创建为私有仓库，仅你自己可见</p>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => setMode('select')}>取消</Button>
              <Button
                type="primary"
                loading={creating}
                onClick={handleCreateRepo}
              >
                创建仓库
              </Button>
            </div>
          </>
        )}

        {mode === 'select' && (
          <div className="pt-2 border-t border-gray-100">
            <Button
              type="primary"
              block
              icon={<CloudSyncOutlined />}
              loading={configuring}
              onClick={handleConfigure}
              disabled={!selectedRepo}
            >
              启用同步
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
