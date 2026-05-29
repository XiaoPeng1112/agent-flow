import { Tag } from 'antd'
import {
  BranchesOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'

interface ChangelogEntry {
  version: string
  date: string
  title: string
  type: 'feature' | 'improvement' | 'fix'
  highlights: string[]
  details: string
}

const changelog: ChangelogEntry[] = [
  {
    version: 'v2.1.0',
    date: '2026-05-29',
    title: '企业级路由 & GitHub 集成 & 上下文文档体系',
    type: 'feature',
    highlights: [
      'React Router 企业级路由架构',
      'GitHub OAuth 账号登录',
      'GitHub 仓库信息同步',
      '更新日志页面',
      '项目介绍/功能文档页',
      '.agent-flow/context/ 上下文文档体系',
      'Vite HMR 修复',
      'Sidebar 底部导航重构',
    ],
    details: `本次重大更新将 AgentFlow 从内存状态管理升级为企业级路由驱动架构。引入 react-router-dom v7 + createBrowserRouter，实现 URL 即状态——刷新浏览器、分享链接、前进后退均可完整恢复当前视图。Zustand Store 重构为纯业务数据层，路由状态完全交由 URL 管理。集成 GitHub OAuth 2.0 登录系统（授权码流程），用户登录后可拉取 GitHub 仓库列表。新增 .agent-flow/context/ 目录作为项目上下文持久化方案，纳入 Git 版本控制，支持跨对话/跨人员共享项目知识。同时新增更新日志和项目介绍模块，Sidebar 底部集成导航链接和用户面板。修复了 Vite HMR 与业务 WebSocket 代理路径冲突的问题。`,
  },
  {
    version: 'v2.0.0',
    date: '2026-05-29',
    title: 'MAF 工作流引擎 MVP',
    type: 'feature',
    highlights: [
      'DAG 编排引擎（三层状态机）',
      '多角色 Agent 系统（Planner/Manager/Executor）',
      'Agent Turn 生命周期管理',
      'WebSocket 实时推送',
      '结构化产出物交付',
      'Codex/Claude CLI 集成',
    ],
    details: `AgentFlow v2.0 实现了完整的 MAF（Multi-Agent Flow）架构。基于 DAG 的工作流编排支持节点级别的状态流转（pending → ready → running → wait_user_review → completed），每个节点可绑定不同角色的 Agent 进行自动化执行。通过 WebSocket 实现 Agent 输出的实时流式展示，并提供取消执行、强制重置、节点回滚等企业级操作。`,
  },
  {
    version: 'v1.0.0',
    date: '2026-05-29',
    title: '项目初始化',
    type: 'feature',
    highlights: [
      'Monorepo 架构（client + server）',
      'React 19 + Vite 8 + Tailwind v4',
      'Express + WebSocket 后端',
      'Zustand 状态管理',
      '项目管理 CRUD',
    ],
    details: `AgentFlow 项目正式启动。采用 Monorepo 结构，前端使用 React 19 + Vite 8 + Tailwind CSS v4 + Ant Design 6，后端基于 Express 5 + WebSocket。实现了基础的项目管理功能，为后续的工作流引擎和 Agent 系统奠定基础。`,
  },
]

const typeColors = {
  feature: 'blue',
  improvement: 'green',
  fix: 'orange',
}

const typeLabels = {
  feature: '新功能',
  improvement: '改进',
  fix: '修复',
}

/**
 * 更新日志页面
 */
export function ChangelogPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-10">
        {/* 页面标题 */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm">
              <BranchesOutlined className="text-white text-[18px]" />
            </div>
            <div>
              <h1 className="text-[22px] font-bold text-gray-900">更新日志</h1>
              <p className="text-[13px] text-gray-500">AgentFlow 版本更新记录</p>
            </div>
          </div>
        </div>

        {/* 时间线 */}
        <div className="relative">
          {/* 时间轴线 */}
          <div className="absolute left-[19px] top-8 bottom-0 w-[2px] bg-gradient-to-b from-indigo-200 via-gray-200 to-transparent" />

          {changelog.map((entry, idx) => (
            <div key={entry.version} className="relative pl-14 pb-12">
              {/* 时间轴圆点 */}
              <div className={`absolute left-2.5 top-1 w-[18px] h-[18px] rounded-full border-[3px] ${
                idx === 0
                  ? 'border-indigo-500 bg-indigo-100'
                  : 'border-gray-300 bg-white'
              }`} />

              {/* 版本头 */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[16px] font-bold text-gray-900">{entry.version}</span>
                <Tag color={typeColors[entry.type]} className="!text-[11px]">{typeLabels[entry.type]}</Tag>
                <span className="text-[12px] text-gray-400">{entry.date}</span>
              </div>

              <h3 className="text-[15px] font-semibold text-gray-800 mb-3">{entry.title}</h3>

              {/* 功能亮点 */}
              <div className="flex flex-wrap gap-2 mb-4">
                {entry.highlights.map((h) => (
                  <span key={h} className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 border border-gray-100 rounded-md text-[12px] text-gray-600">
                    <ThunderboltOutlined className="text-[10px] text-indigo-400" />
                    {h}
                  </span>
                ))}
              </div>

              {/* 详细描述 */}
              <p className="text-[13px] text-gray-600 leading-relaxed">{entry.details}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
