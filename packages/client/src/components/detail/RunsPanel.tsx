import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Empty, Progress, Tag, Modal, Form, Input, Select, Space, App, Popconfirm, Dropdown } from 'antd'
import {
  PlusOutlined,
  PlayCircleOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PauseCircleOutlined,
  RightOutlined,
  DeleteOutlined,
  MoreOutlined,
  ClearOutlined,
} from '@ant-design/icons'
import { useAppStore } from '../../store/appStore'
import { runApi } from '../../api'
import type { Project, Run, TaskNode, TaskNodeStatus, WorkflowTemplate } from '../../types'

interface Props {
  project: Project
}

const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string; tagColor: string }> = {
  created: { color: '#6b7280', icon: <ClockCircleOutlined />, label: '已创建', tagColor: 'default' },
  running: { color: '#3b82f6', icon: <PlayCircleOutlined />, label: '运行中', tagColor: 'processing' },
  paused: { color: '#f59e0b', icon: <PauseCircleOutlined />, label: '已暂停', tagColor: 'warning' },
  completed: { color: '#10b981', icon: <CheckCircleOutlined />, label: '已完成', tagColor: 'success' },
  failed: { color: '#ef4444', icon: <CloseCircleOutlined />, label: '失败', tagColor: 'error' },
}

export function RunsPanel({ project }: Props) {
  const navigate = useNavigate()
  const runs = useAppStore((s) => s.runs)
  const setRuns = useAppStore((s) => s.setRuns)
  const addRun = useAppStore((s) => s.addRun)
  const removeRun = useAppStore((s) => s.removeRun)
  const templates = useAppStore((s) => s.templates)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const { message } = App.useApp()

  useEffect(() => {
    runApi.list(project.id)
      .then((res) => setRuns(res.runs))
      .catch(console.error)
  }, [project.id])

  const projectRuns = runs.filter((r) => r.projectId === project.id)

  const handleSelectRun = (runId: string) => {
    navigate(`/projects/${project.id}/runs/${runId}`)
  }

  const handleDeleteRun = async (runId: string) => {
    try {
      await runApi.delete(runId)
      removeRun(runId)
      message.success('已删除')
    } catch (err: any) {
      message.error(`删除失败: ${err.message}`)
    }
  }

  const handleClearCompleted = async () => {
    const completed = projectRuns.filter((r) => r.status === 'completed' || r.status === 'failed')
    if (completed.length === 0) {
      message.info('没有可清理的 Run')
      return
    }
    for (const run of completed) {
      try {
        await runApi.delete(run.id)
        removeRun(run.id)
      } catch { /* 忽略单个失败 */ }
    }
    message.success(`已清理 ${completed.length} 个已结束的 Run`)
  }

  return (
    <div>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-[15px] font-semibold text-gray-900">工作流 Runs</h3>
          <p className="text-[12px] text-gray-400 mt-0.5">每个 Run 是一次完整的 AI 工作流执行实例</p>
        </div>
        <Space size="small">
          {projectRuns.length > 0 && (
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'clear-completed',
                    icon: <ClearOutlined />,
                    label: '清理已完成/失败',
                    onClick: handleClearCompleted,
                  },
                ],
              }}
              trigger={['click']}
            >
              <Button icon={<MoreOutlined />} />
            </Dropdown>
          )}
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setShowCreateModal(true)}
          >
            新建 Run
          </Button>
        </Space>
      </div>

      {/* Run 列表 */}
      {projectRuns.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span className="text-gray-400">
              还没有工作流实例，点击"新建 Run"从模板创建
            </span>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {projectRuns.map((run) => (
            <RunCard key={run.id} run={run} onClick={() => handleSelectRun(run.id)} onDelete={() => handleDeleteRun(run.id)} />
          ))}
        </div>
      )}

      {/* 创建 Run 弹窗 */}
      {showCreateModal && (
        <CreateRunModal
          projectId={project.id}
          templates={templates}
          onCreated={(run) => {
            addRun(run)
            setShowCreateModal(false)
            navigate(`/projects/${project.id}/runs/${run.id}`)
          }}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  )
}

// ─── Run 卡片 ───

function RunCard({ run, onClick, onDelete }: { run: Run; onClick: () => void; onDelete: () => void }) {
  const config = statusConfig[run.status] || statusConfig.created
  const completedNodes = run.nodes.filter((n) => n.status === 'completed' || n.status === 'skipped').length
  const totalNodes = run.nodes.length
  const progress = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0

  return (
    <Card
      hoverable
      onClick={onClick}
      className="group !border-gray-200 hover:!border-indigo-300 transition-all !bg-white"
      styles={{ body: { padding: '14px 18px' } }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[14px] font-medium text-gray-800 truncate">{run.name}</span>
            <Tag color={config.tagColor} className="!text-[11px] !px-1.5 !mr-0">
              {config.label}
            </Tag>
          </div>
          <div className="text-[11px] text-gray-400">
            {new Date(run.createdAt).toLocaleString('zh-CN')} · {completedNodes}/{totalNodes} 节点
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Popconfirm
            title="确定删除此 Run？"
            description="删除后不可恢复"
            onConfirm={(e) => { e?.stopPropagation(); onDelete() }}
            onCancel={(e) => e?.stopPropagation()}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <button
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all rounded"
            >
              <DeleteOutlined className="text-[12px]" />
            </button>
          </Popconfirm>
          <RightOutlined className="text-gray-300 text-[12px]" />
        </div>
      </div>

      {/* 进度条 */}
      <Progress
        percent={progress}
        size="small"
        strokeColor="#6366f1"
        trailColor="#f1f5f9"
        showInfo={false}
        className="!mb-3"
      />

      {/* 节点状态缩略图 */}
      <div className="flex gap-1.5 flex-wrap">
        {run.nodes.map((node) => (
          <NodeDot key={node.id} node={node} />
        ))}
      </div>
    </Card>
  )
}

// ─── 节点状态小圆点 ───

function NodeDot({ node }: { node: TaskNode }) {
  const colors: Record<TaskNodeStatus, string> = {
    pending: '#d1d5db',
    ready: '#93c5fd',
    running: '#fbbf24',
    wait_user_review: '#fb923c',
    completed: '#34d399',
    failed: '#f87171',
    skipped: '#e5e7eb',
  }

  return (
    <div
      className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-50 rounded"
      title={`${node.name}: ${node.status}`}
    >
      <div
        className={`w-2 h-2 rounded-full ${node.status === 'running' ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: colors[node.status] }}
      />
      <span className="text-[10px] text-gray-500">{node.name}</span>
    </div>
  )
}

// ─── 创建 Run 弹窗 ───

function CreateRunModal({
  projectId,
  templates,
  onCreated,
  onClose,
}: {
  projectId: string
  templates: WorkflowTemplate[]
  onCreated: (run: Run) => void
  onClose: () => void
}) {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const { message } = App.useApp()

  const handleCreate = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      const res = await runApi.create({
        projectId,
        templateId: values.templateId,
        name: values.name || undefined,
      })
      onCreated(res.run)
    } catch (err: any) {
      if (err?.message) {
        message.error(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="新建工作流 Run"
      open={true}
      onCancel={onClose}
      onOk={handleCreate}
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      width={520}
      centered
    >
      <Form form={form} layout="vertical" className="mt-4">
        <Form.Item name="name" label="Run 名称（可选）">
          <Input placeholder="留空则自动生成" />
        </Form.Item>

        <Form.Item
          name="templateId"
          label="工作流模板"
          rules={[{ required: true, message: '请选择模板' }]}
        >
          <Select placeholder="选择工作流模板">
            {templates.map((tpl) => (
              <Select.Option key={tpl.id} value={tpl.id}>
                <Space>
                  <span>{tpl.name}</span>
                  <span className="text-gray-400 text-[11px]">({tpl.nodes.length} 节点)</span>
                </Space>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        {/* 模板预览 */}
        <Form.Item noStyle shouldUpdate={(prev, curr) => prev.templateId !== curr.templateId}>
          {({ getFieldValue }) => {
            const templateId = getFieldValue('templateId')
            const tpl = templates.find((t) => t.id === templateId)
            if (!tpl) return null
            return (
              <div className="bg-gray-50 rounded-lg p-3 mb-2">
                <div className="text-[12px] text-gray-500 mb-2">{tpl.description}</div>
                <div className="flex items-center gap-1 flex-wrap">
                  {tpl.nodes.map((node, idx) => (
                    <div key={node.id} className="flex items-center">
                      <Tag className="!text-[11px] !m-0">{node.name}</Tag>
                      {idx < tpl.nodes.length - 1 && (
                        <RightOutlined className="text-[10px] text-gray-300 mx-1" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          }}
        </Form.Item>
      </Form>
    </Modal>
  )
}
