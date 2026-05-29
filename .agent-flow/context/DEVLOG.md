# 开发日志

## 2026-05-29（Day 1）— 从零到 v2.1

整个项目在今天下午一个会话内从零搭建完成，经历了三个主要版本迭代：

### v1.0.0 — 项目初始化 & 基础框架

**完成内容**:
- Monorepo 搭建（npm workspaces: packages/client + packages/server）
- 前端：React 19 + Vite 8 + Tailwind CSS v4 + Ant Design 6 + Zustand 5
- 后端：Express 5 + WebSocket (ws) + tsx 热更新
- 项目 CRUD 功能（创建/删除/列表）
- Sidebar + 项目详情面板基础 UI
- 数据持久化到 ~/.agent-flow/*.json

**遇到的问题**:
- Tailwind CSS v4 的 `space-y-*` 与 Ant Design 冲突 → 改用 `flex flex-col gap-*`
- 卡片间距不符合预期 → 调整 padding 和 gap 值

### v2.0.0 — MAF 工作流引擎 MVP

**完成内容**:
- DAG 编排引擎实现（三层状态机：Run → Node → Turn）
- 多角色 Agent 系统（Planner/Manager/Executor）
- Agent Turn 生命周期管理（启动/流式输出/完成/取消）
- WebSocket 实时推送 Agent 输出
- 结构化产出物（Artifacts）交付
- Codex CLI / Claude CLI 集成
- 工作流模板管理（4 个内置模板）
- Skills 扫描与管理（扫描 .catpaw/skills 目录）
- Run 详情页：DAG 视图 + 节点操作（启动/审批/打回/跳过/回滚/强制重置）
- Agent 面板：显示可用 Agent 状态
- 任务日志面板：实时展示操作记录

**遇到的问题**:
- Node.js 16 无法运行 Vite 8 → 需要 nvm use 20
- Token 统计需从 Agent 进程 stdout 解析 → 通过 turn_completed 事件推送

### v2.1.0 — 企业级路由 & GitHub 集成

**完成内容**:
- React Router Dom v7 企业级路由架构
  - `createBrowserRouter` + `basename: '/agent-flow'`
  - 路由：/ → /projects/:id/:tab → /projects/:id/runs/:runId → /changelog → /about
  - AppLayout 作为根布局组件（Sidebar + Outlet）
- Zustand Store 重构：移除所有路由相关状态，仅保留业务数据
- GitHub OAuth 2.0 后端实现（AuthService）
  - 授权码流程 → access_token → 用户信息
  - 会话持久化到 ~/.agent-flow/auth.json
- 前端 Auth API 客户端
- UserPanel 组件（Sidebar 底部，登录/用户信息/登出）
- ChangelogPage（时间线样式更新日志）
- AboutPage（完整项目文档：定位/架构/功能/使用方法）
- Vite HMR 修复（hmr.path: '/__vite_hmr' 避免与 /ws 代理冲突）
- .agent-flow/context/ 上下文文档体系

**遇到的问题**:
- Sidebar 中 `useParams()` 获取不到子路由参数 → 因为 Sidebar 在父路由渲染，改用 `useLocation().pathname` 正则提取
- 用户反馈"默认项目没了" → 实际数据正常（2 个项目在 projects.json），是 Sidebar useParams bug 导致没有高亮选中项目
- 更新日志日期错误 → 所有版本都是今天（2026-05-29）完成的

### 删除的文件

- `src/App.tsx` — 被 AppLayout + RouterProvider 取代
- `src/components/detail/ProjectDetail.tsx` — 被 ProjectPage 路由页面取代

### 代码统计

- 前端源文件：约 25 个
- 后端源文件：约 10 个
- 总模块数（Vite build）：3227 个（含依赖）
- 生产构建体积：~1.1MB（gzip ~345KB）
