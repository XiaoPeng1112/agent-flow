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
    version: 'v2.3.1',
    date: '2026-05-30',
    title: '工作流模板完善 & 异步安全修复',
    type: 'fix',
    highlights: [
      '三个轻量模板补充交付汇总节点',
      '所有模板补充 outputContracts 产出物合同',
      'auto-execute 修复：启动前先转换节点状态',
      '路由层 async/await 完善',
      'deleteRun 持久化 await',
      '健康检查版本号更新至 v2.3.1',
    ],
    details: `v2.3.1 针对 v2.3.0 code review 中发现的遗漏进行补全修复。

【模板完善】快速功能迭代、Bug 修复流程、前后端并行开发三个工作流模板均补充了缺失的「交付汇总」(deliver) 节点，确保所有流程都有最终的产出物收拢环节；同时为这三个模板的每个节点补充了 outputContracts 定义，与标准 SDD 模板保持一致，让产出物合同校验机制对所有模板生效。

【异步安全修复】auto-execute 端点修复：批量启动节点前先调用 workflowEngine.startNode() 将节点状态从 ready → running，避免 Agent 进程启动时节点仍处于 ready 状态导致状态不一致；路由层所有调用 async WorkflowEngine 方法的 handler 统一加上 async/await，防止 Promise 静默失败；deleteRun 方法改为 async 并 await persist() 确保删除操作持久化；健康检查版本号从遗留的 2.0.0 更新为 2.3.1。`,
  },
  {
    version: 'v2.3.0',
    date: '2026-05-30',
    title: '安全加固 & DAG 增强 & AI 开发流程优化',
    type: 'feature',
    highlights: [
      'WebSocket ManagedWS 防内存泄漏',
      'cancelTurn 防重复提交',
      'NodeDetailPanel key 修复',
      'persist() async/await 数据安全',
      'OAuth state CSRF 防护',
      '文件系统路径穿越防护',
      '孤儿 running 节点自动重置',
      'Context Chaining（节点上下文传递）',
      'Agent 产出物结构化解析',
      '条件分支与动态 DAG',
      '多 Agent 并行自动执行',
      'Prompt 模板化（{{变量}} 语法）',
      'Token 消耗追踪与成本统计',
      'Git 集成与 Diff Review',
      'Skill 智能推荐引擎',
    ],
    details: `v2.3.0 是一次全面的安全加固、架构增强和 AI 开发流程优化版本。

【安全修复】WebSocket 重连改为 ManagedWebSocket 模式（dispose 标志位防止递归泄漏）；cancelTurn 引入 cancelledTurns Set 防止 close handler 重复提交节点状态；persist() 所有状态变更方法改为 async/await 防止数据丢失；OAuth 回调增加 state 参数校验（CSRF 防护，10 分钟 TTL）；文件系统 API 增加 allowedRoots 路径安全校验防止路径穿越攻击。

【稳定性增强】NodeDetailPanel 增加 key={selectedNode.id} 强制重新挂载解决切换节点时状态残留问题；服务启动时自动检测并重置孤儿 running 节点（进程丢失后不再永远卡死）。

【DAG 编排增强】新增 EdgeCondition 支持条件分支（status/output_contains/expression 三种模式），computeReadyNodes 自动跳过条件不满足的节点；Context Chaining 自动聚合前置节点的 Turn 输出和产出物注入到后续节点上下文；RunConfig 支持 autoExecute/maxParallel 并行执行配置，/auto-execute API 一键批量启动所有 ready 节点。

【AI 开发流程优化】Agent 输出自动结构化解析（提取代码块、JSON 产出物声明并创建 Artifact）；Prompt 模板化支持 {{node.name}}、{{predecessor.summary}} 等内置变量和自定义变量替换；Token 消耗按 Run/Node 粒度统计并估算成本（基于 Claude Sonnet 定价）；Git 集成提供仓库状态、commit 列表、diff 获取与变更摘要能力；Skill 智能推荐基于关键词匹配和节点类型评分自动推荐最相关的 Skills。`,
  },
  {
    version: 'v2.2.0',
    date: '2026-05-29',
    title: '后端服务状态监测 & 离线提示 & GitHub Pages 部署',
    type: 'feature',
    highlights: [
      '后端服务健康检测（心跳轮询）',
      '侧边栏实时状态指示器',
      '离线横幅含完整启动命令',
      'gh-pages 一键部署 GitHub Pages',
      'Skills 多工具目录扫描（CatPaw/Claude/Codex）',
      '前后端通信机制（REST + WebSocket + Proxy）',
    ],
    details: `新增后端服务状态监测系统：前端通过 useServerStatus Hook 每 10 秒轮询 /health 端点，连续 2 次失败判定离线。侧边栏底部新增状态指示器（绿色=在线、蓝色脉动=连接中、红色=离线），离线时顶部显示红色横幅并给出完整的终端启动命令（cd ~/Desktop/work/agent-flow && nvm use 20 && npm run dev）。集成 gh-pages 包实现前端一键部署到 GitHub Pages，无需 GitHub Actions workflow 权限。Skills 扫描路径扩展支持 CatPaw、Claude、Codex 三套工具的全局和项目级目录。`,
  },
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
