import { useState, useEffect, useCallback } from 'react'
import { Card, Tag, Table, Empty, Spin, Alert, Button, Tooltip, Space, Progress, Popconfirm, Input, Modal, Timeline, Badge, App } from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  StopOutlined,
  HistoryOutlined,
  ReloadOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import {
  l1RuleApi,
  type L1Rule,
  type L1RuleStats,
  type RuleLifecycleStatus,
} from '../../api'
import type { Run } from '../../types'

interface Props {
  run: Run
}

// ─── 状态配置 ───
const STATUS_CONFIG: Record<RuleLifecycleStatus, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: '草稿', color: 'default', icon: <FileTextOutlined /> },
  active: { label: '生效中', color: 'green', icon: <CheckCircleOutlined /> },
  decaying: { label: '衰减中', color: 'orange', icon: <ClockCircleOutlined /> },
  deprecated: { label: '已废弃', color: 'red', icon: <StopOutlined /> },
  archived: { label: '已归档', color: 'default', icon: <DeleteOutlined /> },
}

export function L1RulePanel({ run }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<L1RuleStats | null>(null)
  const [rules, setRules] = useState<L1Rule[]>([])
  const [selectedRule, setSelectedRule] = useState<L1Rule | null>(null)
  const [changelogVisible, setChangelogVisible] = useState(false)
  const { message } = App.useApp()

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsRes, rulesRes] = await Promise.allSettled([
        l1RuleApi.getStats(),
        l1RuleApi.getRulesForTemplate(run.templateId),
      ])
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.stats)
      if (rulesRes.status === 'fulfilled') setRules(rulesRes.value.rules)
      if (statsRes.status === 'rejected' && rulesRes.status === 'rejected') {
        setError('L1 规则服务不可用')
      }
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [run.templateId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleActivate = async (ruleId: string) => {
    try {
      await l1RuleApi.activateRule(ruleId)
      message.success('规则已激活')
      fetchData()
    } catch (err: any) {
      message.error(`激活失败: ${err.message}`)
    }
  }

  const handleDeprecate = async (ruleId: string, reason: string) => {
    try {
      await l1RuleApi.deprecateRule(ruleId, reason)
      message.success('规则已废弃')
      fetchData()
    } catch (err: any) {
      message.error(`废弃失败: ${err.message}`)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Spin size="large" tip="加载 L1 规则数据..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Alert type="warning" message="L1 规则服务不可用" description={error} showIcon />
      </div>
    )
  }

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      {/* 统计概览 */}
      {stats && <StatsOverview stats={stats} />}

      {/* 规则列表 */}
      <RuleListSection
        rules={rules}
        onActivate={handleActivate}
        onDeprecate={handleDeprecate}
        onViewChangelog={(rule) => { setSelectedRule(rule); setChangelogVisible(true) }}
        onRefresh={fetchData}
      />

      {/* 变更历史弹窗 */}
      <ChangelogModal
        visible={changelogVisible}
        rule={selectedRule}
        onClose={() => { setChangelogVisible(false); setSelectedRule(null) }}
      />
    </div>
  )
}

// ═══════════════ 统计概览 ═══════════════

function StatsOverview({ stats }: { stats: L1RuleStats }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card size="small" className="!border-gray-200">
          <div className="text-center">
            <div className="text-2xl font-semibold text-gray-800">{stats.total}</div>
            <div className="text-xs text-gray-500">总规则数</div>
          </div>
        </Card>
        <Card size="small" className="!border-green-200 !bg-green-50/30">
          <div className="text-center">
            <div className="text-2xl font-semibold text-green-600">{stats.byStatus?.active ?? 0}</div>
            <div className="text-xs text-gray-500">生效中</div>
          </div>
        </Card>
        <Card size="small" className="!border-blue-200 !bg-blue-50/30">
          <div className="text-center">
            <div className="text-2xl font-semibold text-blue-600">{stats.byStatus?.draft ?? 0}</div>
            <div className="text-xs text-gray-500">草稿</div>
          </div>
        </Card>
        <Card size="small" className="!border-orange-200 !bg-orange-50/30">
          <div className="text-center">
            <div className="text-2xl font-semibold text-orange-500">{stats.byStatus?.decaying ?? 0}</div>
            <div className="text-xs text-gray-500">衰减中</div>
          </div>
        </Card>
        <Card size="small" className="!border-purple-200 !bg-purple-50/30">
          <div className="text-center">
            <div className="text-2xl font-semibold text-purple-600">
              {stats.averageEffectiveness > 0 ? `${Math.round(stats.averageEffectiveness * 100)}%` : '-'}
            </div>
            <div className="text-xs text-gray-500">平均有效性</div>
          </div>
        </Card>
      </div>

      {/* 高效规则排行 */}
      {(stats.topEffective?.length ?? 0) > 0 && (
        <Card size="small" title={<Space><span>🏆</span><span>最有效规则</span></Space>}>
          <div className="space-y-2">
            {stats.topEffective.map((item, idx) => (
              <div key={item.ruleId} className="flex items-center gap-3">
                <Badge count={idx + 1} style={{ backgroundColor: idx === 0 ? '#faad14' : '#d9d9d9' }} />
                <span className="text-sm text-gray-700 flex-1">{item.nodeName}</span>
                <Tag color="green">改善 {Math.round(item.improvement * 100)}%</Tag>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ═══════════════ 规则列表 ═══════════════

function RuleListSection({
  rules,
  onActivate,
  onDeprecate,
  onViewChangelog,
  onRefresh,
}: {
  rules: L1Rule[]
  onActivate: (id: string) => void
  onDeprecate: (id: string, reason: string) => void
  onViewChangelog: (rule: L1Rule) => void
  onRefresh: () => void
}) {
  const [deprecateReason, setDeprecateReason] = useState('')

  if (rules.length === 0) {
    return (
      <Card title="规则列表" size="small" extra={<Button icon={<ReloadOutlined />} size="small" onClick={onRefresh}>刷新</Button>}>
        <Empty
          description="当前模板暂无 L1 规则"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        >
          <p className="text-xs text-gray-400">
            L1 规则会在 Agent 反复犯同一错误时自动沉淀生成
          </p>
        </Empty>
      </Card>
    )
  }

  const columns = [
    {
      title: '节点',
      dataIndex: 'nodeName',
      key: 'nodeName',
      width: 140,
      render: (name: string) => <span className="font-medium text-gray-700">{name}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      filters: [
        { text: '生效中', value: 'active' },
        { text: '草稿', value: 'draft' },
        { text: '衰减中', value: 'decaying' },
        { text: '已废弃', value: 'deprecated' },
        { text: '已归档', value: 'archived' },
      ],
      onFilter: (value: any, record: L1Rule) => record.status === value,
      render: (status: RuleLifecycleStatus) => {
        const config = STATUS_CONFIG[status]
        return <Tag color={config.color} icon={config.icon}>{config.label}</Tag>
      },
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 60,
      render: (v: number) => <span className="text-gray-500">v{v}</span>,
    },
    {
      title: '触发次数',
      dataIndex: 'totalTriggerCount',
      key: 'triggers',
      width: 80,
      sorter: (a: L1Rule, b: L1Rule) => a.totalTriggerCount - b.totalTriggerCount,
    },
    {
      title: '有效性',
      key: 'effectiveness',
      width: 140,
      render: (_: any, record: L1Rule) => {
        const eff = record.effectiveness
        if (eff.postRuleSamples < 10) {
          return <span className="text-xs text-gray-400">样本不足</span>
        }
        const improvePct = Math.round(eff.improvementRate * 100)
        const color = improvePct >= 20 ? '#52c41a' : improvePct >= 5 ? '#faad14' : '#ff4d4f'
        return (
          <Tooltip title={`基线 reject 率: ${(eff.baselineRejectRate * 100).toFixed(1)}% → 当前: ${(eff.currentRejectRate * 100).toFixed(1)}%`}>
            <Progress
              percent={Math.abs(improvePct)}
              size="small"
              strokeColor={color}
              format={() => `${improvePct >= 0 ? '+' : ''}${improvePct}%`}
            />
          </Tooltip>
        )
      },
    },
    {
      title: '衰减分',
      key: 'decay',
      width: 90,
      render: (_: any, record: L1Rule) => {
        if (record.status === 'archived' || record.status === 'deprecated') return <span className="text-gray-300">-</span>
        const score = record.decayInfo.decayScore
        const color = score >= 0.7 ? '#52c41a' : score >= 0.3 ? '#faad14' : '#ff4d4f'
        return (
          <Tooltip title={`最后触发: ${record.decayInfo.daysSinceLastTrigger.toFixed(0)} 天前`}>
            <Progress percent={Math.round(score * 100)} size="small" strokeColor={color} format={() => score.toFixed(2)} />
          </Tooltip>
        )
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: any, record: L1Rule) => (
        <Space size="small">
          {(record.status === 'draft' || record.status === 'decaying') && (
            <Tooltip title="激活规则">
              <Button
                type="text"
                size="small"
                icon={<PlayCircleOutlined className="text-green-500" />}
                onClick={() => onActivate(record.id)}
              />
            </Tooltip>
          )}
          {(record.status === 'active' || record.status === 'draft' || record.status === 'decaying') && (
            <Popconfirm
              title="废弃规则"
              description={
                <Input
                  placeholder="请输入废弃原因"
                  value={deprecateReason}
                  onChange={(e) => setDeprecateReason(e.target.value)}
                  size="small"
                />
              }
              onConfirm={() => {
                onDeprecate(record.id, deprecateReason || '手动废弃')
                setDeprecateReason('')
              }}
              okText="确认废弃"
              cancelText="取消"
            >
              <Tooltip title="废弃规则">
                <Button type="text" size="small" icon={<StopOutlined className="text-red-400" />} />
              </Tooltip>
            </Popconfirm>
          )}
          <Tooltip title="查看变更历史">
            <Button
              type="text"
              size="small"
              icon={<HistoryOutlined className="text-blue-500" />}
              onClick={() => onViewChangelog(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  return (
    <Card
      title={<Space><FileTextOutlined /><span>规则列表</span><Tag>{rules.length} 条</Tag></Space>}
      size="small"
      extra={<Button icon={<ReloadOutlined />} size="small" onClick={onRefresh}>刷新</Button>}
    >
      <Table
        dataSource={rules}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 10, showSizeChanger: false }}
        expandable={{
          expandedRowRender: (record) => <RuleItemsExpand rule={record} />,
        }}
      />
    </Card>
  )
}

// ═══════════════ 规则条目展开 ═══════════════

function RuleItemsExpand({ rule }: { rule: L1Rule }) {
  if (!rule.items?.length) {
    return <div className="text-xs text-gray-400 py-2">无规则条目</div>
  }

  return (
    <div className="py-2 space-y-2">
      <div className="text-xs font-medium text-gray-600 mb-2">规则检查要点：</div>
      {rule.items.map((item, idx) => (
        <div key={idx} className="flex items-start gap-2 pl-2 border-l-2 border-indigo-200">
          <Tag color={item.severity === 'critical' ? 'red' : item.severity === 'high' ? 'orange' : item.severity === 'medium' ? 'blue' : 'default'} className="!text-xs shrink-0">
            {item.severity}
          </Tag>
          <div className="flex-1">
            <div className="text-sm text-gray-700">{item.description}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              出现 {item.frequency} 次 · 最后触发 {new Date(item.lastSeen).toLocaleDateString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ═══════════════ 变更历史弹窗 ═══════════════

function ChangelogModal({ visible, rule, onClose }: { visible: boolean; rule: L1Rule | null; onClose: () => void }) {
  if (!rule) return null

  return (
    <Modal
      title={`规则变更历史 — ${rule.nodeName}`}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={600}
    >
      <div className="mb-4 flex items-center gap-2 text-xs text-gray-500">
        <span>规则 ID: {rule.id}</span>
        <span>·</span>
        <span>当前版本: v{rule.version}</span>
        <span>·</span>
        <Tag color={STATUS_CONFIG[rule.status].color}>{STATUS_CONFIG[rule.status].label}</Tag>
      </div>
      {!rule.changelog?.length ? (
        <Empty description="暂无变更记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Timeline
          items={rule.changelog.slice().reverse().map((entry) => ({
            color: entry.description.includes('归档') || entry.description.includes('废弃') ? 'red' :
                   entry.description.includes('恢复') || entry.description.includes('激活') ? 'green' : 'blue',
            children: (
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">v{entry.version}</span>
                  <span className="text-xs text-gray-400">{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
                <div className="text-sm text-gray-600 mt-0.5">{entry.description}</div>
                {(entry.changes?.length ?? 0) > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {entry.changes.slice(0, 5).map((c, i) => (
                      <div key={i} className="text-xs text-gray-400 pl-2 border-l border-gray-200">{c}</div>
                    ))}
                    {entry.changes.length > 5 && (
                      <span className="text-xs text-gray-300">... +{entry.changes.length - 5} 条</span>
                    )}
                  </div>
                )}
              </div>
            ),
          }))}
        />
      )}
    </Modal>
  )
}
