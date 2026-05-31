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

---

## ADR-008: Context Chaining 自动聚合前置节点上下文

**日期**: 2026-05-30  
**状态**: 已实施

**背景**: DAG 工作流中后续节点需要前置节点的产出作为输入。最初方案是手动在 prompt 中引用前置节点结果，但这要求用户了解 DAG 拓扑并手动维护引用关系，容易遗漏且不灵活。

**决策**: 引入 `buildNodeContext()` 函数，在节点启动前自动遍历 DAG 所有前置节点（通过反向边追溯），聚合它们最后一个 completed Turn 的输出摘要和 Artifacts 列表，注入到当前节点的 `context.predecessorOutputs` 字段。

**实现要点**:
- `NodeContext.predecessorOutputs[]` 包含每个前置节点的 nodeName、nodeType、summary（Turn 输出截取）、artifacts
- Agent prompt 通过模板变量 `{{predecessor.summary}}` 引用
- 只聚合直接前置节点（一跳），不递归传递（避免上下文爆炸）

**原因**:
- DAG 拓扑已经隐含了信息依赖关系，不需要额外声明
- 自动化减少配置负担，降低出错概率
- 统一的上下文结构方便 Agent 解析和利用
- 如果不这么做：后续节点拿不到前置产出，等于每个节点独立执行、丧失流程价值

---

## ADR-009: OutputContracts 产出物合同机制

**日期**: 2026-05-30  
**状态**: 已实施

**背景**: Agent 执行完毕后输出是非结构化文本，难以自动判断是否满足了节点的交付要求。

**决策**: 每个模板节点定义 `outputContracts: OutputContract[]`，声明该节点应产出的结构化物件（类型、格式、是否必选）。Agent 输出经结构化解析后，自动与合同比对校验。

**原因**:
- 让 Agent 明确"要交什么"，提升输出质量
- 合同校验可自动判断节点是否真正"完成"
- 为后续的质量门禁和自动审批提供依据
- 统一产出物格式，便于 Context Chaining 传递

---

## ADR-010: 所有模板统一包含 deliver（交付汇总）节点

**日期**: 2026-05-30  
**状态**: 已实施

**背景**: 最初只有标准 SDD 模板有 deliver 节点，其他三个轻量模板以 test 节点收尾。Code Review 发现这导致轻量流程没有最终的产出物收拢环节。

**决策**: 所有 4 个内置模板都在最后增加 deliver 节点（type: 'deliver', agentRole: 'manager'），负责汇总前置节点产出物、生成交付报告。

**原因**:
- 保持模板行为一致性——所有流程都有明确的"完成"标志
- deliver 节点聚合所有前置 Artifacts，生成结构化交付清单
- 便于下游系统（CI/CD、项目管理工具）对接

---

## ADR-011: 文件系统 API 路径安全防护

**日期**: 2026-05-30  
**状态**: 已实施

**背景**: FileSystemService 提供了文件读写能力，如果不做路径校验，恶意请求可通过 `../../etc/passwd` 等路径穿越攻击访问系统文件。

**决策**: 引入 `allowedRoots` 白名单机制。所有文件操作前先 `path.resolve()` 规范化，再检查是否以某个 allowedRoot 开头。不通过则拒绝。通过环境变量 `ALLOWED_FILE_ROOTS` 配置，默认为 `process.cwd()`。

**原因**:
- 最小权限原则
- 即使部署在共享环境也安全
- 零运行时依赖（纯 path 模块实现）

---

## ADR-012: OAuth state CSRF 防护

**日期**: 2026-05-30  
**状态**: 已实施

**背景**: OAuth 回调如果不校验 state 参数，攻击者可伪造回调 URL 进行 CSRF 攻击。

**决策**: 发起 OAuth 时生成随机 state 存入 Map（10 分钟 TTL 自动过期），回调时校验 state 一致性，使用后立即删除。

**原因**:
- OAuth 2.0 安全规范的标准要求
- 防止第三方伪造授权回调
- TTL 自动清理防止内存泄漏

---

## ADR-013: GitHub Pages 静态部署 + 子路径 basename

**日期**: 2026-05-30  
**状态**: 已实施

**背景**: 需要一个免费、无需服务器的前端展示方案。GitHub Pages 部署在 `username.github.io/repo-name` 子路径下。

**决策**: 使用 gh-pages 包直接部署到 GitHub Pages。Vite `base: '/agent-flow/'` + React Router `basename: '/agent-flow'` 保证子路径下资源和路由正常工作。

**原因**:
- 零成本，自动 HTTPS
- 无需 GitHub Actions workflow 配置权限
- 本地一条命令 `npm run deploy` 完成部署

---

## ADR-014: 产出物闭环基于 Git worktree Diff + 三种合并策略

**日期**: 2026-05-31  
**状态**: 已实施

**背景**: Agent 执行完毕后产出的代码变更只能以文本形式查看（Artifacts），用户无法像 GitHub PR 那样逐行审查变更、对比前后差异，也无法选择合并方式。这导致"AI 写完代码 → 人确认 → 合入"的闭环缺失最后一环。

**决策**: 实现 `ArtifactMergeService`，基于已有的 `RepoIsolationService`（Git worktree）执行 `git diff`，将 unified diff 解析为结构化的 `FileDiff[]`（含 DiffHunk、DiffLine），前端 `DiffReviewPanel` 以 GitHub PR 风格展示行级 diff。合并支持三种策略：squash（压缩单提交）、merge（保留历史）、rebase（变基线性历史）。

**原因**:
- 复用已有的 worktree 基础设施（ADR 无新依赖引入）
- 行级 diff 审查是代码质量保障的关键环节
- 三种合并策略覆盖不同团队的 Git 工作流偏好
- 闭环意味着 Agent 产出 → 人审查 → 选择策略合入/丢弃，全链路可控

**注意事项**:
- diff 解析器为纯字符串处理实现，不依赖外部库
- 丢弃操作会同时清理 worktree 和删除分支，不可逆

---

## ADR-015: 可观测性指标通过事件总线零侵入采集

**日期**: 2026-05-31  
**状态**: 已实施

**背景**: 需要追踪工作流全链路的运行效率（节点耗时、Token 消耗、质量指标），但不希望侵入 WorkflowEngine 核心逻辑。

**决策**: 实现独立的 `MetricsCollector` 服务，通过订阅 WorkflowEngine 的事件总线（`node_started`、`turn_completed`、`node_approved`、`node_rejected`）自动采集指标，无需修改引擎核心代码。指标数据持久化到 `~/.agent-flow/metrics/metrics.json`，前端通过 REST API 读取并展示多维度仪表盘。

**原因**:
- 事件驱动解耦：MetricsCollector 只是事件监听者，WorkflowEngine 无需感知指标采集的存在
- 单一职责：指标采集逻辑集中在一个服务中，便于扩展新指标维度
- 持久化保证：指标数据跨 Session 保留，支持历史趋势分析
- 效率评分可帮助用户识别低效节点和高消耗 Agent，指导优化

**效率评分算法**:
- 综合考虑三个维度：执行时间（越快越好）、Token 消耗（越少越好）、质量（首次通过率越高越好）
- 加权公式输出 0-100 分，方便直观对比
