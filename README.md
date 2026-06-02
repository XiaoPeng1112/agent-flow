# AgentFlow

AI 驱动的多 Agent 协作开发工作流引擎

[![GitHub Pages](https://img.shields.io/badge/Demo-GitHub%20Pages-blue)](https://xiaopeng1112.github.io/agent-flow/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 简介

AgentFlow 是一个 **Agent 编排调度中心（Orchestrator）**，核心理念是 **MAF（Multi-Agent Flow）**——将软件开发拆解为多个角色（规划者、管理者、执行者），每个角色由专门的 Agent 承担，通过 DAG（有向无环图）编排实现高效协作。

它作为总控台连接本地终端、IDE 编辑器以及 Codex/Claude 等 AI 工具，实现从需求输入到代码交付的全流程闭环操作。

## 核心特性

- **DAG 工作流引擎**：三层状态机（Run → Node → Turn），支持条件分支、并行执行
- **多角色 Agent 系统**：Planner / Manager / Executor 各司其职
- **Per-Project Agent 配置**：按项目维度启用/禁用 Agent，DAG 节点仅展示已启用的 Agent
- **Context Chaining**：节点间自动传递上下文，DAG 拓扑决定信息流向
- **MAF 基础设施**：仓库隔离、Skill 物化、权限控制、A2A 通信、合同验证、健壮性服务
- **产出物闭环**：Git worktree Diff Review + Squash/Merge/Rebase 合并策略，类 GitHub PR 代码审查
- **可观测性**：全链路指标采集（时间/Token/质量）+ 效率评分 + 持久化 + 可视化仪表盘
- **实时通信**：WebSocket 推送 Agent 输出流，前端即时展示执行进度
- **数据同步**：GitHub Private Repo 多设备同步 + 多用户隔离 + gitRemote 跨设备自动匹配
- **工程质量**：React.lazy 代码分割、ErrorBoundary 错误隔离、Vitest 单元测试（122 cases）
- **架构健康**：SQLite + WAL 持久化、WorkflowEngine Facade 模式、路由模块化（12 个子路由文件）

## 技术栈

| 前端 | 后端 |
|------|------|
| React 19 + TypeScript 6 | Express 5 + TypeScript |
| Vite 8 | WebSocket (ws) |
| Tailwind CSS v4 | Vitest (单元测试) |
| Ant Design 6 | Node.js 20+ |
| Zustand 5 + React Router 7 | SQLite + WAL (better-sqlite3) |

## 快速开始

```bash
# 克隆项目
git clone https://github.com/XiaoPeng1112/agent-flow.git
cd agent-flow

# 切换 Node 版本（需要 20+）
nvm use 20

# 安装依赖
npm install

# 启动开发服务器（前后端同时启动）
npm run dev

# 打开浏览器
open http://localhost:5173/agent-flow/
```

启动后侧边栏底部显示绿色状态灯即表示后端正常连接。

## 项目结构

```
agent-flow/
├── packages/
│   ├── client/          # 前端 React 应用
│   │   └── src/
│   │       ├── components/  # UI 组件（common/detail/layout/sidebar）
│   │       ├── hooks/       # 自定义 Hooks（useRequest）
│   │       ├── pages/       # 路由页面（React.lazy 懒加载）
│   │       ├── router/      # 路由配置
│   │       └── store/       # Zustand 状态管理
│   └── server/          # 后端 Express 服务
│       ├── tests/       # Vitest 单元测试（122 cases）
│       └── src/
│           ├── routes/    # 路由模块（12 个子路由文件）
│           └── services/  # 业务服务层（25 个模块）
├── docs/                # 使用手册
└── .agent-flow/context/ # 项目上下文文档
```

## 测试

```bash
# 运行单元测试
cd packages/server && npm test

# Watch 模式
npm run test:watch

# 覆盖率报告
npm run test:coverage
```

## 部署

```bash
# 一键部署前端到 GitHub Pages
npm run deploy
```

后端运行在本地 `localhost:3001`，前端通过浏览器直接连接本地后端。

## 文档

- [使用手册](docs/USER-MANUAL.md) — 完整的功能说明和 API 参考
- [架构文档](.agent-flow/context/ARCHITECTURE.md) — 技术架构和设计原理
- [开发日志](.agent-flow/context/DEVLOG.md) — 版本迭代记录
- [技术决策](.agent-flow/context/DECISIONS.md) — ADR 技术决策记录

## 版本历史

| 版本 | 日期 | 重点 |
|------|------|------|
| v2.7.3 | 2026-06-02 | SQLite+WAL 持久化迁移 + WorkflowEngine Facade 拆分 + api.ts 路由模块化 + Vitest 122 cases |
| v2.7.2 | 2026-06-01 | 多用户数据隔离 + gitRemote 跨设备自动匹配 |
| v2.7.1 | 2026-06-01 | GitHub Private Repo 数据同步 + Context DB 多设备同步 |
| v2.7.0 | 2026-05-31 | 反馈闭环（FeedbackCollector + WeeklyDigest）+ 轻量迭代机制 |
| v2.6.0 | 2026-05-31 | 产出物闭环（Diff Review + Merge）+ 可观测性增强（Metrics 指标采集 + 可视化） |
| v2.5.0 | 2026-05-31 | Per-Project Agent 配置（项目级 Agent 启用/禁用 + DAG 节点过滤） |
| v2.4.1 | 2026-05-30 | 工程质量提升（代码分割 / ErrorBoundary / useRequest / Vitest） |
| v2.4.0 | 2026-05-30 | MAF 六大服务模块 |
| v2.3.0 | 2026-05-30 | 安全加固 + DAG 增强 + AI 开发流程优化 |
| v2.2.0 | 2026-05-29 | 后端状态监测 + GitHub Pages 部署 |
| v2.1.0 | 2026-05-29 | 企业级路由 + GitHub OAuth |
| v2.0.0 | 2026-05-29 | MAF 工作流引擎 MVP |
| v1.0.0 | 2026-05-29 | 项目初始化 |

## 许可证

MIT License
