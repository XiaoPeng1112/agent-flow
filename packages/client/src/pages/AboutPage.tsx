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
  SafetyCertificateOutlined,
  SendOutlined,
  ExperimentOutlined,
  BranchesOutlined,
  HistoryOutlined,
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
          <p className="text-[15px] text-gray-500 mb-4">AI 驱动的多 Agent 协作开发工作流引擎 · v2.7.1</p>
          <div className="flex items-center justify-center gap-2">
            <Tag color="blue">DAG 可视化</Tag>
            <Tag color="purple">多角色 Agent</Tag>
            <Tag color="green">自动化工作流</Tag>
            <Tag color="cyan">企业级架构</Tag>
            <Tag color="orange">项目级配置</Tag>
            <Tag color="volcano">Diff Review</Tag>
            <Tag color="geekblue">Metrics 可观测</Tag>
            <Tag color="magenta">反馈闭环</Tag>
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
              核心理念是 <strong>MAF（Multi-Agent Flow）</strong>——多 Agent 流式编排框架。
              不同于单一 AI 助手模式，AgentFlow 将软件开发拆解为多个角色（规划者、管理者、执行者），
              每个角色由专门的 Agent 承担，通过 DAG（有向无环图）编排实现高效协作。
            </p>
          </div>

          {/* 相关开源项目 & 官方文档参考 — 可折叠 */}
          <details className="mt-5 bg-white border border-gray-100 rounded-xl group">
            <summary className="px-5 py-4 cursor-pointer select-none flex items-center justify-between hover:bg-gray-50 rounded-xl transition-colors">
              <span className="text-[13px] font-semibold text-gray-700">设计理念参考 & 相关开源项目</span>
              <span className="text-[11px] text-gray-400 group-open:hidden">点击展开 ↓</span>
              <span className="text-[11px] text-gray-400 hidden group-open:inline">收起 ↑</span>
            </summary>
            <div className="px-5 pb-5 space-y-2.5 text-[12px] text-gray-600 leading-relaxed">
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
          </details>
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
                '@xyflow/react (DAG 可视化)',
                'react-markdown + remark-gfm (Markdown 渲染)',
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
                'Vitest (单元测试框架)',
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
                label: <CollapseLabel icon={<RobotOutlined />} text="Agents — 多角色 AI 系统 & 项目级配置" />,
                children: (
                  <div className="text-[13px] text-gray-600 leading-relaxed">
                    <p>AgentFlow 支持多种 Agent 后端，通过 CLI 进程方式调用：</p>
                    <p className="mt-2"><strong>Codex CLI：</strong>OpenAI 官方的 Codex 命令行工具，擅长代码生成和重构任务。</p>
                    <p className="mt-2"><strong>Claude CLI：</strong>Anthropic 的 Claude 命令行工具，擅长分析和文档生成。</p>
                    <p className="mt-2"><strong>选择策略：</strong>系统优先选择 codex-universal，其次 claude-universal，最后任意可用 Agent。</p>
                    <p className="mt-2"><strong>执行模式：</strong>非阻塞异步执行，WebSocket 实时推送输出流，支持中途取消。</p>
                    <p className="mt-2"><strong>Per-Project Agent 配置（v2.5.0）：</strong>支持按项目维度启用/禁用特定 Agent。进入项目 → Agents Tab → 通过 Switch 开关控制每个 Agent 的启用状态。保存后 DAG 节点详情中的 Agent 下拉列表仅展示已启用的 Agent，让用户只关注自己拥有 API Key 的 Provider。</p>
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

        {/* ═══ AI 开发流程优化 ═══ */}
        <section className="mb-12">
          <SectionTitle icon={<ThunderboltOutlined />} title="AI 开发流程优化（v2.3+）" color="orange" />
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100 rounded-xl p-6 mb-5">
            <p className="text-[14px] text-gray-700 leading-[1.8]">
              AgentFlow v2.3 在 AI 开发流程化方面进行了深度优化，目标是让 Agent 不仅能执行单个任务，更能<strong>自动化地串联整个开发链路</strong>，
              实现从需求到交付的高效闭环。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <ArchCard
              icon={<ApiOutlined />}
              title="Context Chaining"
              desc="节点间自动传递上下文：前置节点的 Turn 输出和产出物自动聚合为后续节点的输入上下文，无需手动搬运信息。"
              color="#f59e0b"
            />
            <ArchCard
              icon={<CodeOutlined />}
              title="产出物结构化解析"
              desc="Agent 输出自动提取代码块（带文件名识别）和 JSON 结构化声明，自动创建 Artifact 进入节点产出物列表。"
              color="#ef4444"
            />
            <ArchCard
              icon={<ApartmentOutlined />}
              title="条件分支 & 动态 DAG"
              desc="DAG 边支持条件配置（status/output_contains/expression），实现基于执行结果的动态路由选择。"
              color="#8b5cf6"
            />
            <ArchCard
              icon={<RobotOutlined />}
              title="多 Agent 并行执行"
              desc="同层级无依赖节点自动并行启动 Agent 执行，RunConfig 支持配置最大并行度和默认 Agent。"
              color="#06b6d4"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ArchCard
              icon={<ToolOutlined />}
              title="Prompt 模板化"
              desc="支持 {{node.name}}、{{predecessor.summary}} 等变量语法，自动从节点上下文中解析替换，标准化 Agent 输入。"
              color="#10b981"
            />
            <ArchCard
              icon={<DatabaseOutlined />}
              title="Token 消耗追踪"
              desc="按 Run/Node 粒度统计 Token 使用量，自动估算成本（基于模型定价），支持通过 API 查询详细报表。"
              color="#6366f1"
            />
            <ArchCard
              icon={<GithubOutlined />}
              title="Git 集成 & Diff Review"
              desc="内置 Git 服务：仓库状态查询、commit 历史、working/staged diff 获取与变更摘要生成，辅助 Code Review。"
              color="#1f2937"
            />
            <ArchCard
              icon={<AppstoreOutlined />}
              title="Skill 智能推荐"
              desc="根据节点描述和类型，通过关键词匹配和触发词评分自动推荐最相关的 Skills，降低人工配置成本。"
              color="#ec4899"
            />
          </div>
        </section>

        {/* ═══ v2.4.0 MAF 六大服务 ═══ */}
        <section className="mb-12">
          <SectionTitle icon={<SafetyCertificateOutlined />} title="MAF 基础设施（v2.4.0）" color="purple" />
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-100 rounded-xl p-6 mb-5">
            <p className="text-[14px] text-gray-700 leading-[1.8]">
              v2.4.0 补全了 MAF 架构的四大缺失能力，并增加了合同验证引擎和全面的健壮性保障。
              这些服务构成了 Agent 协作的<strong>基础设施层</strong>，使多 Agent 并行开发从"能跑"升级到"可靠运行"。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <ArchCard
              icon={<DatabaseOutlined />}
              title="Repo Isolation"
              desc="Git worktree 池化管理，每个 Run 独立工作目录。支持 worktree / symlink / copy 三种策略，Run 结束自动回收。"
              color="#7c3aed"
            />
            <ArchCard
              icon={<ToolOutlined />}
              title="Skill Materialization"
              desc="白名单/黑名单模式控制 Skill 可见性，运行时物化到 .skills/ 目录，TTL 缓存避免重复 IO，自动注入 Prompt。"
              color="#2563eb"
            />
            <ArchCard
              icon={<SafetyCertificateOutlined />}
              title="Permission Isolation"
              desc="RBAC 策略按 agentRole 定义仓库级和文件级访问规则（glob + read/write/execute），deny-by-default + 审计日志。"
              color="#dc2626"
            />
            <ArchCard
              icon={<SendOutlined />}
              title="A2A Protocol"
              desc="Agent 间异步通信：request/response/delegate/broadcast 四种消息，优先级收件箱 + ACK 确认 + Channel 管理。"
              color="#0891b2"
            />
            <ArchCard
              icon={<CodeOutlined />}
              title="Contract Validation"
              desc="节点完成时自动校验产出物满足 OutputContract：category 精确匹配 + format 兼容矩阵，生成 pass/fail 报告。"
              color="#059669"
            />
            <ArchCard
              icon={<ExperimentOutlined />}
              title="Robustness"
              desc="指数退避重试 + 死信队列（DLQ）+ Checkpoint 快照 + 审计日志。为工作流执行提供容错和全链路可观测。"
              color="#d97706"
            />
          </div>
        </section>

        {/* ═══ v2.5.0 新能力 ═══ */}
        <section className="mb-12">
          <SectionTitle icon={<AppstoreOutlined />} title="DAG 可视化 & 体验升级（v2.5.0）" color="cyan" />
          <div className="bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-100 rounded-xl p-6 mb-5">
            <p className="text-[14px] text-gray-700 leading-[1.8]">
              v2.5.0 聚焦<strong>可视化与用户体验</strong>及<strong>MRF 架构演进</strong>：引入 @xyflow/react 实现 DAG 交互式画布，新增 Run Overview、
              Markdown 渲染、Per-Project Agent 配置；完成第三优先级全部 5 项 MRF 能力——DET 确定性执行、动态 Agent 创建、
              Context DB 四层管理、Agent Tree 可视化、Checkpoint 恢复；并新增 <strong>A2A 消息面板</strong>实现 Agent 间通信的全链路可视化。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ArchCard
              icon={<ApartmentOutlined />}
              title="DAG 可视化画布"
              desc="基于 @xyflow/react 的交互式 DAG 编辑器：Dagre 自动布局、自定义节点（状态色带 + 徽章）、条件边标签、小地图、选中高亮联动。"
              color="#0891b2"
            />
            <ArchCard
              icon={<DatabaseOutlined />}
              title="Run Overview 面板"
              desc="在 Run 列表顶部展示统计摘要：总 Run 数、各状态占比（环形图）、最近活动时间线，快速掌握项目全貌。"
              color="#6366f1"
            />
            <ArchCard
              icon={<CodeOutlined />}
              title="Markdown 渲染引擎"
              desc="Agent 输出和节点 Prompt 使用 react-markdown + remark-gfm 渲染，支持代码高亮、表格、链接等 GFM 语法。"
              color="#10b981"
            />
            <ArchCard
              icon={<RobotOutlined />}
              title="Per-Project Agent 配置"
              desc="项目级别启用/禁用 Agent：Agents Tab → Switch 开关 → 保存后 DAG 节点仅展示已启用 Agent，简化选择流程。"
              color="#8b5cf6"
            />
            <ArchCard
              icon={<ThunderboltOutlined />}
              title="动态 Agent 创建"
              desc="节点执行前按角色 + context 动态创建 Agent 实例，生命周期跟随 Run 自动回收，支持 planner/manager/executor 三角色。"
              color="#f59e0b"
            />
            <ArchCard
              icon={<DatabaseOutlined />}
              title="Context DB 四层管理"
              desc="SYS/L0/L1/L2 四层上下文文件 CRUD + 装配引擎，支持在线编辑和装配预览，一键查看 Agent 收到的完整上下文。"
              color="#dc2626"
            />
            <ArchCard
              icon={<BranchesOutlined />}
              title="Agent Tree 可视化"
              desc="Run 内所有动态 Agent 实例的树形展示，按角色分组（规划层/管理层/执行层），显示实例状态和生命周期。"
              color="#7c3aed"
            />
            <ArchCard
              icon={<HistoryOutlined />}
              title="Checkpoint 恢复"
              desc="Timeline 展示快照列表，支持手动创建/恢复快照，系统健康监控面板（死信队列/待重试/审计日志）。"
              color="#059669"
            />
            <ArchCard
              icon={<CodeOutlined />}
              title="确定性执行层 (DET)"
              desc="DET 模式直接执行脚本不调 LLM（节省 token），HYB 混合模式脚本失败自动回退 LLM，5 分钟超时保护。"
              color="#0d9488"
            />
            <ArchCard
              icon={<SendOutlined />}
              title="A2A 消息面板"
              desc="Agent 间通信可视化：拓扑图展示 Agent 网络关系，时间线追踪消息流转，统计面板量化通信指标。纯 SVG 实现零依赖。"
              color="#0e7490"
            />
          </div>
        </section>

        {/* ═══ v2.6.0 产出物闭环 + 可观测性 ═══ */}
        <section className="mb-12">
          <SectionTitle icon={<SafetyCertificateOutlined />} title="产出物闭环 + 可观测性增强（v2.6.0）" color="green" />
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-100 rounded-xl p-6 mb-5">
            <p className="text-[14px] text-gray-700 leading-[1.8]">
              v2.6.0 实现了从"能执行"到"<strong>可审可控可度量</strong>"的关键跨越：Agent 产出的代码变更通过 Diff Review 面板进行可视化审查和合并，
              全链路运行指标通过 Metrics 面板实时展示和分析，形成完整的质量保障闭环。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ArchCard
              icon={<BranchesOutlined />}
              title="Diff Review 面板"
              desc="GitHub PR 风格的代码审查：左侧文件树（变更类型着色 + 统计徽章），右侧行级 Diff（unified 格式），支持 Approve/Discard 操作。"
              color="#059669"
            />
            <ArchCard
              icon={<CodeOutlined />}
              title="ArtifactMergeService"
              desc="基于 Git worktree 对比产出物与主分支差异，生成 FileDiff[]。支持 squash/merge/rebase 三种合并策略，文件级选择性合并。"
              color="#0d9488"
            />
            <ArchCard
              icon={<ExperimentOutlined />}
              title="Metrics 指标面板"
              desc="四个子视图：Overview（KPI + 趋势）、Timeline（甘特图）、Token Distribution（饼图 + 柱状图）、Efficiency（雷达图 + 优化建议）。"
              color="#7c3aed"
            />
            <ArchCard
              icon={<DatabaseOutlined />}
              title="MetricsCollector"
              desc="事件总线零侵入采集：执行时间、Token 消耗（按模型）、质量评分（三维度加权）。持久化到 JSON，支持历史趋势查询。"
              color="#2563eb"
            />
          </div>
        </section>

        {/* ═══ v2.7.0 反馈闭环 ═══ */}
        <section className="mb-12">
          <SectionTitle icon={<ExperimentOutlined />} title="反馈闭环 + 轻量迭代（v2.7.0）" color="orange" />
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100 rounded-xl p-6 mb-5">
            <p className="text-[14px] text-gray-700 leading-[1.8]">
              v2.7.0 建立了"<strong>发现问题 → 记录 → 决策改进</strong>"的最小反馈闭环。系统自动采集审批打回、Diff 丢弃、执行失败等反馈信号，
              汇总为周报摘要供用户决策。同时明确拒绝了完整自演进系统，确立了<strong>ADR-016：信息收集可以自动化，决策执行必须人在回路</strong>的设计原则。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ArchCard
              icon={<DatabaseOutlined />}
              title="FeedbackCollector"
              desc="三个触发点自动记录反馈（review_reject / diff_discard / execution_failure），JSON Lines 持久化，支持按时间/类型/严重度查询。"
              color="#d97706"
            />
            <ArchCard
              icon={<ExperimentOutlined />}
              title="WeeklyDigest"
              desc="汇总 feedback + metrics 生成 Markdown 周报：执行概览、反馈统计、高频问题 Top 5、Agent 表现排行。"
              color="#9333ea"
            />
            <ArchCard
              icon={<DesktopOutlined />}
              title="Feedback 子 Tab"
              desc="MetricsPanel 内新增反馈视图：4 个统计卡片 + 反馈记录列表 + 生成周报按钮。复用现有面板，零新增顶级导航。"
              color="#0891b2"
            />
            <ArchCard
              icon={<SafetyCertificateOutlined />}
              title="ADR-016 约束规则"
              desc="数据采集只收集不决策；系统改进通过'用户+AI对话'而非自动修改代码；新功能复用现有UI容器；自动化默认关闭。"
              color="#dc2626"
            />
          </div>
        </section>

        {/* ═══ v2.7.1 数据同步 ═══ */}
        <section className="mb-12">
          <SectionTitle icon={<CloudServerOutlined />} title="数据同步 — 多设备互通（v2.7.1）" color="cyan" />
          <div className="bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-100 rounded-xl p-6 mb-5">
            <p className="text-[14px] text-gray-700 leading-[1.8]">
              v2.7.1 实现了基于 <strong>GitHub Private Repo</strong> 的多设备数据同步，解决"公司电脑和家里电脑数据不互通"的痛点。
              用户登录 GitHub 后，系统自动创建私有仓库作为数据中心，通过 Contents API 实现文件级同步。
              采用 <strong>LWW（Last Write Wins）</strong>冲突策略，系统启动自动 pull、写操作防抖 push，日常使用完全无感知。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ArchCard
              icon={<CloudServerOutlined />}
              title="SyncService"
              desc="基于 GitHub Contents API 的文件级同步服务（~740 行），支持 Base64 编解码、SHA 校验、递归目录扫描。自动创建 agent-flow-data 私有仓库。"
              color="#0891b2"
            />
            <ArchCard
              icon={<DatabaseOutlined />}
              title="Context DB 同步"
              desc="将项目级 .agent-flow/context/ 知识文件（架构文档、开发日志、技术决策）同步到远端 context-db/{projectId}/，支持任意深度目录。"
              color="#7c3aed"
            />
            <ArchCard
              icon={<SafetyCertificateOutlined />}
              title="LWW 冲突策略"
              desc="Push 以本地为准覆盖远端；Pull 对比文件 mtime 与 lastSyncAt，本地更新则跳过覆盖。启动自动 pull + 写操作防抖 push。"
              color="#059669"
            />
            <ArchCard
              icon={<DesktopOutlined />}
              title="SyncPanel 前端面板"
              desc="Sidebar 底部同步面板：显示同步状态、上次同步时间、文件数统计、手动 Push/Pull 按钮、GitHub 未登录引导。"
              color="#d97706"
            />
          </div>
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

export default AboutPage
