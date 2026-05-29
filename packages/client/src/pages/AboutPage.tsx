import { Tag, Collapse } from 'antd'
import {
  RocketOutlined,
  ApartmentOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  AppstoreOutlined,
  GithubOutlined,
  ToolOutlined,
  CodeOutlined,
  DesktopOutlined,
  DatabaseOutlined,
  HeartOutlined,
  CloudServerOutlined,
} from '@ant-design/icons'

/**
 * 项目介绍 / 功能介绍页面
 *
 * 完整介绍 AgentFlow 的：
 *   - 项目定位与愿景
 *   - 核心架构原理
 *   - 功能模块说明
 *   - 使用方法
 */
export function AboutPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-8 py-10">

        {/* ═══ 项目标题 ═══ */}
        <div className="text-center mb-12">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <RocketOutlined className="text-white text-[28px]" />
          </div>
          <h1 className="text-[28px] font-bold text-gray-900 mb-2">AgentFlow</h1>
          <p className="text-[15px] text-gray-500 mb-4">AI 驱动的多 Agent 协作开发工作流引擎</p>
          <div className="flex items-center justify-center gap-2">
            <Tag color="blue">DAG 编排</Tag>
            <Tag color="purple">多角色 Agent</Tag>
            <Tag color="green">自动化工作流</Tag>
            <Tag color="cyan">企业级架构</Tag>
          </div>
        </div>

        {/* ═══ 项目定位 ═══ */}
        <section className="mb-12">
          <SectionTitle icon={<ThunderboltOutlined />} title="项目定位" color="indigo" />
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-xl p-6">
            <p className="text-[14px] text-gray-700 leading-[1.8]">
              AgentFlow 是一个<strong>真正的 Agent 编排调度中心（Orchestrator）</strong>，而非简单的流程展示工具。
              它作为总控台连接本地终端、IDE 编辑器以及 Codex/Claude 等 AI 工具，实现从需求输入到代码交付的全流程闭环操作。
            </p>
            <p className="text-[14px] text-gray-700 leading-[1.8] mt-3">
              核心理念是 <strong>MAF（Multi-Agent Flow）</strong>——多角色 Agent 框架。
              不同于单一 AI 助手模式，AgentFlow 将软件开发拆解为多个角色（规划者、管理者、执行者），
              每个角色由专门的 Agent 承担，通过 DAG（有向无环图）编排实现高效协作。
            </p>
          </div>

          {/* 相关开源项目 & 官方文档参考 */}
          <div className="mt-5 bg-white border border-gray-100 rounded-xl p-5">
            <h4 className="text-[13px] font-semibold text-gray-700 mb-3">设计理念参考 & 相关开源项目</h4>
            <div className="space-y-2.5 text-[12px] text-gray-600 leading-relaxed">
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                <div>
                  <a href="https://www.anthropic.com/research/building-effective-agents" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-medium">Anthropic: Building Effective Agents</a>
                  <span className="text-gray-400 ml-1">— Anthropic 官方 Agent 架构指南，定义了 Workflow vs Agent 的核心区分，以及编排模式（Orchestrator-Workers、Router、Evaluator-Optimizer）的最佳实践。</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                <div>
                  <a href="https://www.anthropic.com/engineering/built-multi-agent-research-system" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-medium">Anthropic: How We Built Multi-Agent Research System</a>
                  <span className="text-gray-400 ml-1">— Anthropic 官方工程博客，介绍 Lead Agent + Sub-agents 协作架构的生产实践。</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                <div>
                  <a href="https://github.com/openai/openai-agents-python" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-medium">OpenAI Agents SDK</a>
                  <span className="text-gray-400 ml-1">— OpenAI 官方多 Agent 框架（Swarm 的生产升级版），提供 Agents、Handoffs、Guardrails 等核心概念。</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                <div>
                  <a href="https://github.com/openai/codex" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-medium">OpenAI Codex CLI</a>
                  <span className="text-gray-400 ml-1">— OpenAI 官方终端 AI Agent（Rust 实现），AgentFlow 的核心执行后端之一。</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                <div>
                  <a href="https://github.com/ruvnet/ruflo" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-medium">Ruflo (Claude Flow)</a>
                  <span className="text-gray-400 ml-1">— 面向 Claude Code 的多 Agent 编排平台（49K+ Stars），提供 100+ 专用 Agent、Swarm 协同、自学习记忆等企业级能力。</span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                <div>
                  <a href="https://platform.claude.com/docs/en/managed-agents/multi-agent" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-medium">Claude API: Multiagent Sessions</a>
                  <span className="text-gray-400 ml-1">— Anthropic 官方 API 文档，描述多 Agent 会话编排的原生支持。</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ 核心架构 ═══ */}
        <section className="mb-12">
          <SectionTitle icon={<ApartmentOutlined />} title="核心架构原理" color="purple" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <ArchCard
              icon={<DatabaseOutlined />}
              title="三层状态机"
              desc="Run（工作流实例）→ Node（任务节点）→ Turn（Agent 执行轮次），每层独立状态流转，支持暂停、回滚、重试。"
              color="#6366f1"
            />
            <ArchCard
              icon={<ApartmentOutlined />}
              title="DAG 编排引擎"
              desc="基于有向无环图的任务编排，节点间通过 edges 定义依赖关系，支持并行执行和顺序约束。"
              color="#8b5cf6"
            />
            <ArchCard
              icon={<RobotOutlined />}
              title="多角色 Agent 系统"
              desc="Planner（规划者）拆解需求、Manager（管理者）协调资源、Executor（执行者）编写代码，各司其职。"
              color="#06b6d4"
            />
            <ArchCard
              icon={<ApiOutlined />}
              title="实时通信架构"
              desc="WebSocket 实时推送 Agent 输出流，前端即时展示执行进度，支持中断和人机交互。"
              color="#10b981"
            />
          </div>

          {/* 状态流转图 */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-5">
            <h4 className="text-[13px] font-semibold text-gray-700 mb-3">节点状态流转</h4>
            <div className="flex items-center gap-2 flex-wrap text-[12px]">
              <StateChip label="pending" color="#9ca3af" />
              <Arrow />
              <StateChip label="ready" color="#3b82f6" />
              <Arrow />
              <StateChip label="running" color="#f59e0b" />
              <Arrow />
              <StateChip label="wait_user_review" color="#f97316" />
              <Arrow />
              <StateChip label="completed" color="#10b981" />
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              任何节点均可跳过（→ skipped）、失败后重试（failed → ready）、或回滚到前一状态
            </p>
          </div>
        </section>

        {/* ═══ 技术栈 ═══ */}
        <section className="mb-12">
          <SectionTitle icon={<CodeOutlined />} title="技术栈" color="cyan" />
          <div className="grid grid-cols-2 gap-4">
            <TechStack
              title="前端 (packages/client)"
              items={[
                'React 19 + TypeScript 6',
                'Vite 8 (Dev + Build)',
                'Tailwind CSS v4 (@tailwindcss/vite)',
                'Ant Design 6 (组件库)',
                'Zustand 5 (状态管理)',
                'React Router Dom 7 (路由)',
              ]}
            />
            <TechStack
              title="后端 (packages/server)"
              items={[
                'Express 5 + TypeScript',
                'WebSocket (ws 库)',
                'GitHub OAuth 2.0',
                'Node.js 20+ (tsx 热更新)',
                'JSON 文件持久化',
                'CLI 进程管理 (Codex/Claude)',
              ]}
            />
          </div>
        </section>

        {/* ═══ 功能模块 ═══ */}
        <section className="mb-12">
          <SectionTitle icon={<AppstoreOutlined />} title="功能模块详解" color="green" />

          <Collapse
            ghost
            items={[
              {
                key: '1',
                label: <CollapseLabel icon={<ThunderboltOutlined />} text="Runs — 工作流实例管理" />,
                children: (
                  <div className="text-[13px] text-gray-600 leading-relaxed">
                    <p>每个 Run 是一次工作流模板的实例化执行。从模板创建 Run 后，系统会生成 DAG 节点图。</p>
                    <p className="mt-2"><strong>使用方式：</strong>进入项目 → Runs Tab → 点击「新建 Run」 → 选择工作流模板 → 创建后进入 DAG 视图 → 逐节点填写需求并启动 Agent 执行。</p>
                    <p className="mt-2"><strong>核心操作：</strong>启动 Run、启动节点、查看实时输出、验收/打回节点、取消执行、强制重置、节点回滚。</p>
                  </div>
                ),
              },
              {
                key: '2',
                label: <CollapseLabel icon={<ApartmentOutlined />} text="工作流模板 — DAG 编排定义" />,
                children: (
                  <div className="text-[13px] text-gray-600 leading-relaxed">
                    <p>工作流模板定义了从需求到交付的标准化流程。每个模板包含一组有序节点和它们之间的依赖关系（edges）。</p>
                    <p className="mt-2"><strong>内置模板：</strong>全栈开发流程（需求分析 → 架构设计 → 任务拆分 → 编码实现 → 代码审查 → 测试验证 → 交付部署）。</p>
                    <p className="mt-2"><strong>自定义：</strong>支持创建自定义模板，定义节点名称、类型、Agent 角色、Prompt 模板等。</p>
                  </div>
                ),
              },
              {
                key: '3',
                label: <CollapseLabel icon={<ToolOutlined />} text="Skills — 技能注册与发现" />,
                children: (
                  <div className="text-[13px] text-gray-600 leading-relaxed">
                    <p>Skills 是 Agent 可调用的能力单元，以 Markdown 文件形式存储在多个工具的 skills 目录下。</p>
                    <p className="mt-2"><strong>扫描路径（全局级）：</strong>~/.catpaw/skills、~/.claude/skills、~/.codex/skills</p>
                    <p className="mt-2"><strong>扫描路径（项目级）：</strong>项目目录/.catpaw/skills、项目目录/.claude/skills、项目目录/.codex/skills</p>
                    <p className="mt-2"><strong>使用方式：</strong>进入项目 → Skills Tab → 查看已发现的 Skills 列表 → 在节点配置中关联需要的 Skills。</p>
                  </div>
                ),
              },
              {
                key: '4',
                label: <CollapseLabel icon={<RobotOutlined />} text="Agents — 多角色 AI 系统" />,
                children: (
                  <div className="text-[13px] text-gray-600 leading-relaxed">
                    <p>AgentFlow 支持多种 Agent 后端，通过 CLI 进程方式调用：</p>
                    <p className="mt-2"><strong>Codex CLI：</strong>OpenAI 官方的 Codex 命令行工具，擅长代码生成和重构任务。</p>
                    <p className="mt-2"><strong>Claude CLI：</strong>Anthropic 的 Claude 命令行工具，擅长分析和文档生成。</p>
                    <p className="mt-2"><strong>选择策略：</strong>系统优先选择 codex-universal，其次 claude-universal，最后任意可用 Agent。</p>
                    <p className="mt-2"><strong>执行模式：</strong>非阻塞异步执行，WebSocket 实时推送输出流，支持中途取消。</p>
                  </div>
                ),
              },
              {
                key: '5',
                label: <CollapseLabel icon={<GithubOutlined />} text="GitHub 集成 — 账号与仓库同步" />,
                children: (
                  <div className="text-[13px] text-gray-600 leading-relaxed">
                    <p>通过 GitHub OAuth 登录后，AgentFlow 可以：</p>
                    <p className="mt-2"><strong>仓库发现：</strong>自动拉取用户的 GitHub 仓库列表（按更新时间排序，最多 50 个）。</p>
                    <p className="mt-2"><strong>项目关联：</strong>将本地项目与 GitHub 仓库关联，自动获取 repoUrl、默认分支等信息。</p>
                    <p className="mt-2"><strong>配置方式：</strong>在项目设置页 → GitHub 关联区域 → 选择对应仓库进行绑定。</p>
                    <p className="mt-2"><strong>OAuth 配置：</strong>需设置环境变量 GITHUB_CLIENT_ID 和 GITHUB_CLIENT_SECRET（创建 GitHub OAuth App 获取）。</p>
                  </div>
                ),
              },
              {
                key: '6',
                label: <CollapseLabel icon={<DesktopOutlined />} text="路由系统 — URL 驱动状态" />,
                children: (
                  <div className="text-[13px] text-gray-600 leading-relaxed">
                    <p>v2.1 引入 React Router，实现完全由 URL 驱动的页面状态：</p>
                    <p className="mt-2"><strong>路由结构：</strong></p>
                    <code className="block bg-gray-100 rounded-md p-3 mt-1 text-[12px] text-gray-700">
                      {`/                                → 首页
/projects/:projectId/:tab        → 项目详情
/projects/:projectId/runs/:runId → Run 详情
/changelog                       → 更新日志
/about                           → 项目介绍`}
                    </code>
                    <p className="mt-2"><strong>优势：</strong>刷新浏览器不丢失状态、URL 可分享、浏览器前进后退可用、SEO 友好。</p>
                  </div>
                ),
              },
              {
                key: '7',
                label: <CollapseLabel icon={<CloudServerOutlined />} text="前后端通信机制 — 本地服务架构" />,
                children: (
                  <div className="text-[13px] text-gray-600 leading-relaxed">
                    <p>AgentFlow 采用<strong>前后端分离 + 本地后端</strong>架构，前端无论部署在何处（本地 dev server 或 GitHub Pages），都通过浏览器 JS 直接连接用户本机的后端服务。</p>
                    <p className="mt-3"><strong>REST API（数据操作）：</strong></p>
                    <p className="mt-1">所有业务请求统一发往 <code className="px-1.5 py-0.5 bg-gray-100 rounded text-[12px]">http://localhost:3001/api</code>，涵盖项目管理、Runs 操作、Agent 执行、Skills 查询等全部功能。</p>
                    <p className="mt-3"><strong>WebSocket（实时推送）：</strong></p>
                    <p className="mt-1">通过 <code className="px-1.5 py-0.5 bg-gray-100 rounded text-[12px]">ws://localhost:3001/ws</code> 建立持久连接，实时推送 Agent 执行输出流、节点状态变更、Turn 生命周期事件等。断线自动 3 秒重连。</p>
                    <p className="mt-3"><strong>Vite Dev Proxy（开发环境）：</strong></p>
                    <p className="mt-1">本地开发时，Vite 配置了 <code className="px-1.5 py-0.5 bg-gray-100 rounded text-[12px]">/api → localhost:3001</code> 和 <code className="px-1.5 py-0.5 bg-gray-100 rounded text-[12px]">/ws → ws://localhost:3001</code> 代理，解决跨域问题。生产环境（GitHub Pages）则直接请求 localhost:3001。</p>
                    <p className="mt-3"><strong>为什么不部署后端到云端？</strong></p>
                    <p className="mt-1">AgentFlow 后端需要访问用户本地文件系统（扫描 Skills 目录、读取项目文件）并调用本地 CLI 工具（Codex/Claude），这些能力无法在云端实现，因此采用本地运行后端的方案。</p>
                  </div>
                ),
              },
              {
                key: '8',
                label: <CollapseLabel icon={<HeartOutlined />} text="服务状态监测 — 健康检查与离线提示" />,
                children: (
                  <div className="text-[13px] text-gray-600 leading-relaxed">
                    <p>v2.2 新增后端服务状态监测系统，确保用户始终了解后端连接状况：</p>
                    <p className="mt-3"><strong>健康检查机制：</strong></p>
                    <p className="mt-1">前端通过 <code className="px-1.5 py-0.5 bg-gray-100 rounded text-[12px]">useServerStatus</code> Hook 每 10 秒向 <code className="px-1.5 py-0.5 bg-gray-100 rounded text-[12px]">/health</code> 端点发送心跳请求。单次请求超时 5 秒，连续 2 次失败判定为离线。</p>
                    <p className="mt-3"><strong>三种状态：</strong></p>
                    <p className="mt-1">🟢 <strong>online</strong>（在线）— 后端正常运行，侧边栏底部显示绿色指示灯。</p>
                    <p className="mt-1">🔵 <strong>connecting</strong>（连接中）— 首次加载或手动重试时，蓝色脉动动画。</p>
                    <p className="mt-1">🔴 <strong>offline</strong>（离线）— 后端不可达，红色指示灯 + 顶部横幅显示完整启动命令。</p>
                    <p className="mt-3"><strong>离线横幅：</strong></p>
                    <p className="mt-1">当后端离线时，页面顶部出现红色横幅，包含启动后端的完整终端命令（可直接复制），并提供「重试连接」按钮。后端恢复后自动检测并切回在线状态。</p>
                    <p className="mt-3"><strong>启动命令：</strong></p>
                    <code className="block bg-gray-900 rounded-md p-3 mt-1 text-[12px] text-green-400 font-mono leading-[1.8]">
                      {`$ cd ~/Desktop/work/agent-flow\n$ nvm use 20\n$ npm run dev`}
                    </code>
                  </div>
                ),
              },
            ]}
          />
        </section>

        {/* ═══ 快速开始 ═══ */}
        <section className="mb-12">
          <SectionTitle icon={<RocketOutlined />} title="快速开始" color="orange" />
          <div className="bg-gray-900 rounded-xl p-6 text-[13px] font-mono">
            <div className="text-gray-400 mb-1"># 1. 克隆项目</div>
            <div className="text-green-400 mb-3">git clone https://github.com/XiaoPeng1112/agent-flow.git</div>

            <div className="text-gray-400 mb-1"># 2. 安装依赖（需 Node.js 20+）</div>
            <div className="text-green-400 mb-1">cd agent-flow</div>
            <div className="text-green-400 mb-1">nvm use 20</div>
            <div className="text-green-400 mb-3">npm install</div>

            <div className="text-gray-400 mb-1"># 3. 配置 GitHub OAuth（可选，用于登录功能）</div>
            <div className="text-yellow-400 mb-3">export GITHUB_CLIENT_ID=your_id<br/>export GITHUB_CLIENT_SECRET=your_secret</div>

            <div className="text-gray-400 mb-1"># 4. 启动开发服务器（前后端同时启动）</div>
            <div className="text-green-400 mb-3">npm run dev</div>

            <div className="text-gray-400 mb-1"># 5. 打开浏览器（侧边栏底部显示绿色状态灯即表示后端正常）</div>
            <div className="text-cyan-400 mb-3">open http://localhost:5173/agent-flow/</div>

            <div className="text-gray-400 mb-1"># 6. 部署前端到 GitHub Pages（可选）</div>
            <div className="text-green-400">npm run deploy</div>
          </div>
          <p className="text-[12px] text-gray-400 mt-3 leading-relaxed">
            注：后端服务运行在本地 localhost:3001，前端（包括 GitHub Pages 上的版本）通过浏览器直接连接本地后端。如果看到红色"后端服务未连接"横幅，请先在终端执行 npm run dev 启动后端。
          </p>
        </section>

        {/* ═══ 项目信息 ═══ */}
        <section className="mb-8">
          <div className="flex items-center justify-center gap-6 text-[12px] text-gray-400">
            <a
              href="https://github.com/XiaoPeng1112/agent-flow"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-indigo-500 transition-colors"
            >
              <GithubOutlined /> GitHub
            </a>
            <span>Monorepo · packages/client + packages/server</span>
            <span>MIT License</span>
          </div>
        </section>
      </div>
    </div>
  )
}

// ─── 辅助组件 ───

function SectionTitle({ icon, title, color }: { icon: React.ReactNode; title: string; color: string }) {
  const colorMap: Record<string, string> = {
    indigo: 'from-indigo-500 to-indigo-600',
    purple: 'from-purple-500 to-purple-600',
    cyan: 'from-cyan-500 to-cyan-600',
    green: 'from-emerald-500 to-emerald-600',
    orange: 'from-orange-500 to-orange-600',
  }
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${colorMap[color] || colorMap.indigo} flex items-center justify-center text-white text-[14px]`}>
        {icon}
      </div>
      <h2 className="text-[17px] font-bold text-gray-900">{title}</h2>
    </div>
  )
}

function ArchCard({ icon, title, desc, color }: { icon: React.ReactNode; title: string; desc: string; color: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[15px]" style={{ backgroundColor: `${color}12`, color }}>
          {icon}
        </div>
        <h4 className="text-[14px] font-semibold text-gray-800">{title}</h4>
      </div>
      <p className="text-[12px] text-gray-500 leading-relaxed">{desc}</p>
    </div>
  )
}

function TechStack({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <h4 className="text-[13px] font-semibold text-gray-700 mb-3">{title}</h4>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item} className="flex items-center gap-2 text-[12px] text-gray-600">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}

function StateChip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded-md text-white font-medium text-[11px]"
      style={{ backgroundColor: color }}
    >
      {label}
    </span>
  )
}

function Arrow() {
  return <span className="text-gray-300 text-[14px]">→</span>
}

function CollapseLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-2 text-[14px] font-medium text-gray-800">
      <span className="text-indigo-500">{icon}</span>
      {text}
    </span>
  )
}
