# 开发日志

## 2026-05-31 — v2.5.0

### v2.5.0 — Per-Project Agent 配置

**核心功能**：支持按项目维度启用/禁用 Agent，让用户仅在自己拥有 API Key 的 Provider 的 Agent 中选择。

**完成内容**:

1. **类型定义扩展**
   - `ProjectData`（Server）和 `Project`（Client）新增 `enabledAgentIds?: string[]` 字段
   - undefined 表示全部启用，空数组表示全部禁用，向后兼容

2. **Server API**
   - `GET /api/projects/:id/enabled-agents` — 获取项目已启用的 Agent 列表
   - `PUT /api/projects/:id/enabled-agents` — 更新项目 Agent 启用配置
   - 已有 `PUT /api/projects/:id` 也支持 `enabledAgentIds` 字段更新

3. **前端 AgentsPanel 增强**
   - 新增 `ProjectAgentConfig` 组件（卡片样式 + Switch 开关）
   - 支持逐个 Agent 切换启用/禁用
   - 保存成功后调用 `setProjects()` 同步全局 Store，确保其他组件立即获得最新状态

4. **DAG 节点 Agent 下拉过滤**
   - RunDetail 中新增项目级 Agent 过滤逻辑
   - 根据 `currentProject.enabledAgentIds` 过滤 agents 列表后传入 NodeDetailPanel
   - 用户在 DAG 节点详情选择 Agent 时只看到项目已启用的 Agent

**修复的问题**:
- **"保存失败" HTML 错误响应**：Server 代码更新后未重启，返回旧 HTML 而非 JSON → 重启 Server 解决
- **Agent 下拉未同步过滤**：RunDetail 未基于项目配置过滤 agents → 添加 filtering 逻辑
- **Store 未同步**：AgentsPanel 保存后未更新全局 Store → 添加 `setProjects()` 调用

**修改文件**:
- `packages/server/src/types/index.ts` — 添加 `enabledAgentIds`
- `packages/server/src/services/project.ts` — 更新 `updateProject` 支持该字段
- `packages/server/src/routes/api.ts` — 新增两个 API 端点
- `packages/client/src/types/index.ts` — 添加 `enabledAgentIds`
- `packages/client/src/api/index.ts` — 新增 `projectApi.getEnabledAgents/updateEnabledAgents`
- `packages/client/src/components/detail/AgentsPanel.tsx` — 新增 `ProjectAgentConfig`
- `packages/client/src/components/detail/RunDetail.tsx` — 添加 Agent 过滤逻辑

---

## 2026-05-30 — v2.4.1

本日聚焦工程质量提升：代码分割、全局错误隔离、统一请求 Hook 和单元测试覆盖。

### v2.4.1 — 工程质量提升

**完成内容**:

1. **路由级代码分割**
   - 所有 5 个路由页面（Home/Project/RunDetail/Changelog/About）改为 `React.lazy()` 动态导入
   - 新增 `SuspenseWrapper` 组件统一包裹 lazy 路由
   - 新增 `RouteLoadingFallback` 组件提供加载中 UI
   - 构建产物从单一 ~1.1MB chunk 拆分为 845KB 主包 + 独立页面 chunk

2. **React ErrorBoundary**
   - 新增 `components/common/ErrorBoundary.tsx`（class 组件，getDerivedStateFromError）
   - 包裹在 AppLayout 的 `<Outlet />` 外层，捕获页面级崩溃
   - 提供友好错误 UI + 重试按钮，开发环境额外显示错误堆栈

3. **useRequest Hook**
   - 新增 `hooks/useRequest.ts`
   - `useRequest`：完整版，内置 loading 状态、成功/失败 Toast、指数退避重试（可配置最大次数和延迟）
   - `useLoadingAction`：轻量版，仅包含 loading + try/catch 包裹

4. **Vitest 单元测试**
   - 新增 `packages/server/vitest.config.ts`
   - 新增 `packages/server/tests/` 目录，包含三个测试文件：
     - `workflow-engine.test.ts`（26 cases）：Run/Node 生命周期、Turn 管理、拓扑排序
     - `a2a-protocol.test.ts`（26 cases）：消息收发、Channel、broadcast、retry/fail
     - `contract-validator.test.ts`（16 cases）：format 匹配、验证报告
   - 共 68 个测试用例，全部通过
   - `package.json` 添加 `test` / `test:watch` / `test:coverage` 脚本

**遇到的问题**:
- Vitest 在 Node 16 下报错 `styleText is not exported from node:util` → 需要 Node 20+（`nvm use 20`）
- 构建后 vendor chunk（antd）仍有 500KB+ 警告 → 预期行为，页面 chunk 已独立拆分

**新增文件**:
- `packages/client/src/components/common/RouteLoadingFallback.tsx`
- `packages/client/src/components/common/ErrorBoundary.tsx`
- `packages/client/src/hooks/useRequest.ts`
- `packages/server/vitest.config.ts`
- `packages/server/tests/workflow-engine.test.ts`
- `packages/server/tests/a2a-protocol.test.ts`
- `packages/server/tests/contract-validator.test.ts`

---

## 2026-05-30 — v2.4.0

本日聚焦 MAF 架构四大缺失能力的实现 + 健壮性全面增强。

### v2.4.0 — MAF 六大服务模块

**新增 6 个服务模块**（共 ~1500 行新代码）：

1. **RepoIsolationService** (`repo-isolation.ts`)
   - Git worktree 池化管理，支持 worktree / symlink / copy 三种策略
   - Run 级隔离：每个 Run 获得独立工作目录，防止并行冲突
   - 自动回收：Run 结束后归还 worktree，dispose 时清理全部

2. **SkillMaterializationService** (`skill-materialization.ts`)
   - 白名单/黑名单模式：按 agentRole 或 nodeType 控制 Skill 可见性
   - 运行时物化：Skill 文件复制到节点工作目录 `.skills/`
   - TTL 缓存：相同配置在 TTL 窗口内直接复用

3. **PermissionIsolationService** (`permission-isolation.ts`)
   - RBAC 策略：AgentPermissionPolicy 按角色定义仓库和文件访问规则
   - 双层校验：仓库级 glob + 文件级 glob（read/write/execute）
   - Deny-by-default + 审计日志

4. **A2AProtocolService** (`a2a-protocol.ts`)
   - 优先级收件箱：high > normal > low 排序
   - 消息类型：request / response / delegate / broadcast
   - ACK + resolve 确认机制，Channel 管理，过期清理
   - Legacy InboxItem bridge 兼容旧系统

5. **ContractValidatorService** (`contract-validator.ts`)
   - 按 category 精确匹配 + format 兼容性矩阵
   - 验证报告：matched / missing / extra / overall pass/fail

6. **RobustnessService** (`robustness.ts`)
   - 指数退避重试（configurable maxAttempts + backoffFactor）
   - 死信队列（DLQ）：超限任务保留完整上下文
   - Checkpoint 快照：关键时刻保存 Run/Node/Agent 状态
   - 审计日志：全操作带时间戳记录 + JSON 导出

**类型扩展**（`types/index.ts`）：新增 ~220 行类型定义覆盖 RepoPool、MaterializedSkill、AgentPermissionPolicy、A2AMessage、ContractValidationResult、RetryPolicy、DeadLetterItem、Checkpoint、AuditLogEntry 等

**API 路由扩展**（`routes/api.ts`）：新增 ~230 行路由，涵盖 repo-pool、a2a、permissions、contracts、robustness、skill-materialization 六组端点

**服务入口更新**（`index.ts`）：v2.4.0 版本号，所有新服务实例化 + DI 注入 + graceful shutdown 挂载

**编译修复**：解决所有 TS6133/TS6196 未使用变量/导入错误，最终 `tsc --noEmit` 零错误通过

---

## 2026-05-30 — v2.3.0 → v2.3.1

本日主要围绕 Code Review 反馈进行安全加固、架构增强和模板补全。

### v2.3.1 — 工作流模板完善 & 异步安全修复

**完成内容**:
- 三个轻量模板（quick-feature / bug-fix / parallel-dev）补充缺失的「交付汇总」(deliver) 节点
- 三个轻量模板所有节点补充 outputContracts 产出物合同定义
- auto-execute 端点修复：启动 Agent 前先调用 `startNode()` 将节点从 ready → running
- 路由层所有调用 async WorkflowEngine 方法的 handler 统一加上 async/await
- `deleteRun` 方法改为 async 并 await persist()
- 健康检查版本号从遗留的 2.0.0 更新为 2.3.1

**发现的问题**:
- Vite dev server 重启后端口从 5173 变为 5174 → 原因是旧进程未完全释放端口，Vite 自动递增
- `tsx watch` 热更新仅监听 server 代码，client 依赖 Vite HMR，需清除 `.vite` 缓存后重启

### v2.3.0 — 安全加固 & DAG 增强 & AI 开发流程优化

**完成内容**:

安全修复：
- WebSocket ManagedWS 模式（dispose 标志位防止递归重连泄漏）
- cancelTurn 引入 cancelledTurns Set 防止 close handler 重复提交
- persist() 所有状态变更方法改为 async/await 防数据丢失
- OAuth state CSRF 防护（随机 state + 10 分钟 TTL）
- 文件系统 API allowedRoots 路径穿越防护

稳定性增强：
- NodeDetailPanel key={selectedNode.id} 强制重挂载解决状态残留
- 启动时自动检测并重置孤儿 running 节点

DAG 编排增强：
- EdgeCondition 条件分支（status / output_contains / expression）
- Context Chaining：buildNodeContext 自动聚合前置节点的 Turn 输出和产出物
- RunConfig autoExecute / maxParallel 并行执行配置
- /auto-execute API 批量启动所有 ready 节点

AI 开发流程优化：
- Agent 输出结构化解析（提取代码块、JSON 产出物 → Artifact）
- Prompt 模板化 {{变量}} 语法（内置 + 自定义变量）
- Token 消耗追踪与成本统计（按 Run/Node 粒度）
- Git 集成（GitService：仓库状态、commit 列表、diff 获取）
- Skill 智能推荐引擎（关键词匹配 + 节点类型评分）

---

## 2026-05-29 — 从零到 v2.2

整个项目在今天下午一个会话内从零搭建完成，经历了四个主要版本迭代：

### v2.2.0 — 后端服务状态监测 & GitHub Pages 部署

**完成内容**:
- 后端健康检测系统：前端 useServerStatus Hook 每 10 秒轮询 /health
- 侧边栏实时状态指示器（绿色/蓝色脉动/红色三态）
- 离线横幅含完整启动命令
- gh-pages 一键部署 GitHub Pages
- Skills 扫描支持 CatPaw / Claude / Codex 三套工具的全局和项目级目录

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
