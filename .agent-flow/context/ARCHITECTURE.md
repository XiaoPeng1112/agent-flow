# AgentFlow 项目架构

> 最后更新：2026-05-29  
> 维护者：@XiaoPeng1112

## 项目定位

AgentFlow 是一个 **AI 驱动的多 Agent 协作开发工作流引擎**，核心定位为 Agent 编排调度中心（Orchestrator）。它作为总控台连接本地终端、IDE 编辑器以及 Codex/Claude 等 AI 工具，实现从需求输入到代码交付的全流程闭环操作。

核心理念是 **MAF（Multi-Agent Flow）**——多角色 Agent 框架。将软件开发拆解为多个角色（规划者、管理者、执行者），每个角色由专门的 Agent 承担，通过 DAG（有向无环图）编排实现高效协作。

## 仓库信息

- **GitHub**: https://github.com/XiaoPeng1112/agent-flow
- **分支策略**: main 为主分支
- **License**: MIT

## Monorepo 结构

```
agent-flow/
├── packages/
│   ├── client/          # 前端 React 应用
│   │   ├── src/
│   │   │   ├── api/         # API 客户端（REST 请求封装）
│   │   │   ├── components/  # UI 组件
│   │   │   │   ├── detail/    # 项目详情面板（Runs/Workflow/Skills/Agents/Settings）
│   │   │   │   ├── layout/   # 布局组件（AppLayout）
│   │   │   │   └── sidebar/  # 侧边栏（Sidebar/AddProjectModal/UserPanel）
│   │   │   ├── pages/       # 路由页面（Home/Project/RunDetail/Changelog/About）
│   │   │   ├── router/      # React Router 配置
│   │   │   ├── store/       # Zustand 状态管理
│   │   │   └── types/       # TypeScript 类型定义
│   │   ├── vite.config.ts
│   │   └── index.html
│   └── server/          # 后端 Express 服务
│       └── src/
│           ├── index.ts       # 服务入口
│           ├── routes/
│           │   └── api.ts     # REST API 路由定义
│           ├── services/      # 业务服务层
│           │   ├── project.ts       # 项目 CRUD
│           │   ├── template.ts      # 工作流模板管理
│           │   ├── workflow-engine.ts # DAG 工作流引擎（三层状态机）
│           │   ├── agent.ts         # Agent 调度（Codex/Claude CLI）
│           │   ├── auth.ts          # GitHub OAuth 认证
│           │   ├── skill.ts         # Skills 扫描与管理
│           │   ├── filesystem.ts    # 文件系统操作
│           │   └── terminal.ts      # 终端进程管理
│           └── types/
│               └── index.ts
├── .agent-flow/
│   └── context/         # 项目上下文文档（本目录）
├── package.json         # Monorepo 根配置
├── tsconfig.json        # TypeScript 根配置
└── eslint.config.js     # ESLint 配置
```

## 技术栈

### 前端 (packages/client)

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19 | UI 框架 |
| TypeScript | 6 | 类型安全 |
| Vite | 8 | 构建工具 + Dev Server + HMR |
| Tailwind CSS | v4 | 样式（`@tailwindcss/vite` 插件） |
| Ant Design | 6 | 组件库 |
| Zustand | 5 | 状态管理（仅业务数据） |
| React Router Dom | 7 | 路由（URL 驱动状态） |

### 后端 (packages/server)

| 技术 | 版本 | 用途 |
|------|------|------|
| Express | 5 | HTTP 框架 |
| ws | - | WebSocket 实时通信 |
| tsx | - | TypeScript 直接运行 + 热更新 |
| Node.js | 20+ | 运行时（Vite 8 强制要求） |

### 数据持久化

- 项目数据：`~/.agent-flow/projects.json`
- 工作流模板：`~/.agent-flow/templates.json`
- Run 历史：`~/.agent-flow/runs.json`
- 认证信息：`~/.agent-flow/auth.json`
- 日志：localStorage（前端，最近 200 条）

## 核心架构原理

### 三层状态机

```
Run（工作流实例）
  └── Node（任务节点）
       └── Turn（Agent 执行轮次）
```

每层独立状态流转：
- **Run**: idle → running → completed / failed
- **Node**: pending → ready → running → wait_user_review → completed / skipped / failed
- **Turn**: started → streaming → completed / cancelled / error

### DAG 编排引擎

基于有向无环图的任务编排，节点间通过 edges 定义依赖关系。当一个节点的所有前置依赖完成后，该节点自动进入 ready 状态。

### 多角色 Agent 系统

- **Planner（规划者）**: 拆解需求为可执行任务
- **Manager（管理者）**: 协调资源、分配节点
- **Executor（执行者）**: 调用 CLI 工具编写代码

Agent 通过 CLI 进程方式调用（codex-cli / claude-cli），非阻塞异步执行，WebSocket 实时推送输出流。

### 路由架构

```
/                                → 首页（欢迎页）
/projects/:projectId             → 重定向到 /projects/:projectId/runs
/projects/:projectId/:tab        → 项目详情（runs | workflow | skills | agents | settings）
/projects/:projectId/runs/:runId → Run 详情页（DAG 视图 + 节点执行）
/changelog                       → 更新日志
/about                           → 项目介绍
```

设计原则：URL 即状态，刷新/分享链接可完整恢复视图。

## 运行方式

```bash
# 需要 Node.js 20+（Vite 8 要求）
nvm use 20

# 安装依赖
npm install

# 启动开发环境（前后端并行）
npm run dev
# → 前端: http://localhost:5173/agent-flow/
# → 后端: http://localhost:3001/api
# → WebSocket: ws://localhost:3001/ws

# 生产构建
cd packages/client && npx vite build
```

## 环境变量（可选）

```bash
# GitHub OAuth（用于登录功能）
GITHUB_CLIENT_ID=your_id
GITHUB_CLIENT_SECRET=your_secret
```
