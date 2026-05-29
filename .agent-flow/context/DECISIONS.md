# 技术决策记录 (ADR)

> 记录项目中做出的关键技术决策，每条包含背景、决策和原因。

---

## ADR-001: 使用 React Router 替代内存状态管理路由

**日期**: 2026-05-29  
**状态**: 已实施

**背景**: 最初项目使用 Zustand store 中的 `selectedProjectId`、`activeTab`、`selectedRunId` 字段管理当前视图状态。刷新浏览器后状态丢失，用户必须重新选择项目和 tab。

**决策**: 引入 react-router-dom v7，使用 `createBrowserRouter` 配置路由，将视图状态完全映射到 URL。Zustand 仅保留业务数据（projects、runs、templates 列表），不再存储导航状态。

**原因**:
- URL 即状态：刷新、分享链接、前进后退均可恢复视图
- 关注点分离：路由管导航，Store 管数据
- 企业级标准做法，方便后续加权限守卫、代码分割

**注意事项**:
- `basename: '/agent-flow'` 因为部署在子路径下
- Sidebar 中不能用 `useParams()`（它在父路由渲染），改用 `useLocation().pathname` 正则提取 projectId

---

## ADR-002: Tailwind CSS v4 中用 `gap` 替代 `space-y`

**日期**: 2026-05-29  
**状态**: 已实施

**背景**: Tailwind CSS v4 的 `space-y-*` 使用 `:where()` 选择器实现，特异性为 0。与 Ant Design 组件样式冲突时容易被覆盖导致间距失效。

**决策**: 统一使用 `flex flex-col gap-*` 替代 `space-y-*`。

**原因**:
- `gap` 属性作用在容器上，不受子元素样式干扰
- 不依赖兄弟选择器，语义更清晰
- 与 Ant Design 共存无冲突

---

## ADR-003: Vite HMR 使用独立 WebSocket 路径

**日期**: 2026-05-29  
**状态**: 已实施

**背景**: 项目同时代理 `/ws` 路径到后端 WebSocket（业务通信），导致 Vite 的 HMR WebSocket 连接可能受干扰。

**决策**: 在 `vite.config.ts` 中配置 `server.hmr.path: '/__vite_hmr'`，为 HMR 分配独立路径。

**原因**:
- 避免 HMR 和业务 WebSocket 路由冲突
- 确保开发时文件修改能即时反映到浏览器

---

## ADR-004: 数据持久化使用 JSON 文件而非数据库

**日期**: 2026-05-29  
**状态**: 已实施

**背景**: AgentFlow 定位为本地开发工具，单用户场景为主。

**决策**: 所有业务数据（项目、模板、Runs、认证）存储为 `~/.agent-flow/*.json` 文件。

**原因**:
- 零依赖，无需安装数据库
- 人类可读，便于调试和手动修改
- 本地工具场景下性能完全足够
- 后续如需多人协作，可迁移到 SQLite 或远端存储

---

## ADR-005: Agent 通过 CLI 子进程调用

**日期**: 2026-05-29  
**状态**: 已实施

**背景**: 需要对接 OpenAI Codex CLI 和 Anthropic Claude CLI 两种 Agent 后端。

**决策**: 使用 Node.js `child_process.spawn` 启动 CLI 进程，通过 stdout/stderr 流式获取输出，WebSocket 实时推送到前端。

**原因**:
- 复用现有 CLI 工具生态，无需自行实现 API 对接
- 进程隔离，Agent 崩溃不影响主服务
- 支持中途 kill 进程实现取消操作
- 统一的进程管理抽象，方便后续扩展更多 Agent 类型

---

## ADR-006: GitHub OAuth 用于身份认证和仓库关联

**日期**: 2026-05-29  
**状态**: 已实施

**背景**: 需要为 AgentFlow 提供用户身份体系，并能感知用户的代码仓库。

**决策**: 集成 GitHub OAuth 2.0（authorization code 流程），登录后可拉取用户仓库列表。认证信息持久化到 `~/.agent-flow/auth.json`。

**当前能力**:
- 身份认证（登录/登出）
- 获取用户 GitHub profile
- 拉取仓库列表（按更新时间排序，最多 50 个）

**不做的事情**（当前阶段）:
- 不同步代码（不 push/pull）
- 不同步 issue/PR
- 不自动部署

**原因**:
- 本地编排工具不需要深度 Git 集成
- 仓库关联主要用于：Agent 执行时定位 cwd、显示项目来源信息
- 保持轻量，后续按需扩展

---

## ADR-007: 项目上下文存储在 `.agent-flow/context/` 并纳入 Git

**日期**: 2026-05-29  
**状态**: 已实施

**背景**: AI 对话中积累的项目上下文（架构决策、开发日志、待办）在切换新对话时丢失。

**决策**: 在项目根目录创建 `.agent-flow/context/` 目录，存放结构化的项目文档，纳入 Git 版本控制推送到 GitHub。

**多人协作方案**:
- 所有人共享同一份 context 文档
- 修改通过 Git commit + PR review 流程
- 每次对话产出的重要决策/变更，更新到对应文档中
- 冲突解决走 Git 标准 merge 流程

**原因**:
- 简单直接，无需额外基础设施
- 版本可追溯，每次变更有 commit 记录
- 新成员 clone 仓库即获得完整上下文
- AI 助手新对话开始时读取这些文件即可快速恢复
