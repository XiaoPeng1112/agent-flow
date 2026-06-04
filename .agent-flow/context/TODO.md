# 待办与后续计划

> 按优先级排列，P0 = 必须做，P1 = 应该做，P2 = 可以做  
> 最后更新：2026-06-01（v2.7.1）

## 当前阶段已完成 ✅

- [x] Monorepo 基础架构搭建
- [x] DAG 工作流引擎（三层状态机）
- [x] 多角色 Agent 系统（Planner/Manager/Executor）
- [x] WebSocket 实时通信 + ManagedWS 防泄漏
- [x] React Router 企业级路由
- [x] GitHub OAuth 后端（含 CSRF state 校验）
- [x] Sidebar 导航（项目列表 + 更新日志 + 项目介绍 + 用户面板）
- [x] ChangelogPage / AboutPage
- [x] .agent-flow/context/ 上下文文档体系
- [x] 后端健康检测 & 离线横幅
- [x] GitHub Pages 部署（gh-pages）
- [x] Context Chaining（节点上下文自动传递）
- [x] EdgeCondition 条件分支
- [x] OutputContracts 产出物合同
- [x] 所有模板 deliver 节点补全
- [x] 路由层全面 async/await
- [x] 文件系统路径穿越防护
- [x] 孤儿 running 节点启动恢复
- [x] Agent 输出结构化解析
- [x] Prompt 模板化（{{变量}} 语法）
- [x] Token 消耗追踪
- [x] Git 集成（GitService）
- [x] Skill 智能推荐引擎
- [x] Skills 多工具目录扫描（CatPaw/Claude/Codex）
- [x] Repo Isolation（Run 级仓库隔离 + Git worktree 池化）
- [x] Skill Materialization（白名单校验 + 运行时 Skill 副本注入 + TTL 缓存）
- [x] Permission Isolation（RBAC + glob 文件访问控制 + 审计日志）
- [x] A2A Inbox Protocol（优先级收件箱 + ACK 确认 + Channel 管理）
- [x] OutputContract 验证引擎（category+format 匹配 + 验证报告）
- [x] Robustness 健壮性服务（指数退避重试 + 死信队列 + Checkpoint + 审计导出）
- [x] 路由级代码分割（React.lazy + Suspense，页面 chunk 独立拆分）
- [x] React ErrorBoundary 全局错误隔离
- [x] useRequest Hook（Loading / Toast / 指数退避重试）
- [x] Vitest 单元测试（68 cases 覆盖三大核心服务）
- [x] 产出物闭环（ArtifactMergeService：Git worktree Diff Review + Squash/Merge/Rebase）
- [x] 可观测性增强（MetricsCollector：时间/Token/质量指标采集 + 效率评分 + 持久化）
- [x] Diff Review 前端面板（GitHub PR 风格文件树 + 行级 Diff + 合并/丢弃操作）
- [x] Metrics 前端面板（Overview/Timeline/Token Distribution/Efficiency 四视图）

## P0 — 核心功能待完善

- [ ] **GitHub OAuth 前端完整流程**：OAuth 回调页面处理（前端从 URL 提取 code 并交换 token，或后端直接处理完重定向）
- [ ] **GitHub 仓库关联 UI**：在项目 Settings Tab 中添加 GitHub 仓库选择器
- [x] ~~**Run 详情页 DAG 可视化**~~：已在 v2.5.0 实现（@xyflow/react 自定义节点 + 拓扑分层布局）
- [ ] **Agent 执行端到端联调**：确保 codex-cli / claude-cli 安装后可以通过 UI 触发节点执行

## P1 — 体验优化

- [x] ~~**错误处理统一化**~~：已在 v2.4.1 实现（useRequest Hook + ErrorBoundary）
- [ ] **Sidebar 项目右键菜单**：重命名、打开文件夹、复制路径
- [ ] **深色主题一致性**：部分页面（Changelog/About）背景为白色，与 Sidebar 深色不协调
- [x] ~~**代码分割**~~：已在 v2.4.1 实现（React.lazy + Suspense 路由级分割）
- [ ] **移动端适配**：当前仅桌面端布局
- [x] ~~**Vite strictPort 配置**~~：已在 v2.5.0 修复

## P2 — 长期规划

- [x] ~~**多设备数据同步**~~：已在 v2.7.1 实现（GitHub Private Repo + Contents API + LWW 冲突策略）
- [ ] **多人协作**：WebSocket 多客户端同步、乐观更新、冲突解决
- [ ] **权限系统**：基于 GitHub OAuth 的 RBAC 权限守卫
- [ ] **插件体系**：自定义 Agent 类型、自定义节点类型
- [ ] **执行历史回放**：Turn 级别的执行录像回放
- [ ] **数据库迁移**：从 JSON 文件迁移到 SQLite（当数据量增大时）
- [ ] **Docker 容器化**：CI/CD 流程
- [x] ~~**单元测试**~~：已在 v2.4.1 实现（Vitest 68 cases 覆盖三大核心服务）
- [ ] **E2E 测试**：Playwright 覆盖核心用户路径
- [x] ~~**OutputContract 自动校验**~~：已在 v2.4.0 实现（ContractValidatorService）
- [ ] **Context Chaining 可视化**：在 DAG 视图中显示节点间的上下文传递关系
- [x] ~~**A2A 协议前端可视化**~~：已在 v2.5.0 实现（拓扑图 + 时间线 + 统计三视图面板）
- [x] ~~**Checkpoint 恢复 UI**~~：已在 v2.5.0 实现（CheckpointPanel — Timeline 展示 + 创建/恢复快照）
- [x] ~~**产出物闭环**~~：已在 v2.6.0 实现（ArtifactMergeService + DiffReviewPanel）
- [x] ~~**可观测性增强**~~：已在 v2.6.0 实现（MetricsCollector + MetricsPanel）
- [x] ~~**反馈闭环**~~：已在 v2.7.0 实现（FeedbackCollector + WeeklyDigest + Feedback Tab）
- [x] ~~**数据同步**~~：已在 v2.7.1 实现（SyncService — GitHub Private Repo 同步 + Context DB 递归同步）

## 已知问题 🐛

- Vite 8 要求 Node.js 20+，需要通过 `nvm use --delete-prefix v20.19.2` 切换
- ~~生产构建单 chunk 过大（~1.1MB），需做代码分割~~ → 已在 v2.4.1 通过 React.lazy 解决，页面 chunk 已独立拆分
- ~~Vite dev server 未配置 strictPort，端口被占用时会静默递增到下一个可用端口~~ → 已在 v2.5.0 修复
- GitHub OAuth 需要配置环境变量，未配置时登录按钮点击会报错（需加友好提示）
- `tsx watch` 仅监听 server 端代码变更，client 端依赖 Vite HMR 独立热更新
