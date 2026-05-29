# 待办与后续计划

> 按优先级排列，P0 = 必须做，P1 = 应该做，P2 = 可以做

## 当前阶段已完成 ✅

- [x] Monorepo 基础架构搭建
- [x] DAG 工作流引擎（三层状态机）
- [x] 多角色 Agent 系统（Planner/Manager/Executor）
- [x] WebSocket 实时通信
- [x] React Router 企业级路由
- [x] GitHub OAuth 后端
- [x] Sidebar 导航（项目列表 + 更新日志 + 项目介绍 + 用户面板）
- [x] ChangelogPage / AboutPage
- [x] .agent-flow/context/ 上下文文档体系

## P0 — 核心功能待完善

- [ ] **GitHub OAuth 前端完整流程**：OAuth 回调页面处理（当前后端 callback 路由重定向回前端后，前端需要从 URL 提取 code 并交换 token，或者后端直接处理完毕后重定向带标记）
- [ ] **GitHub 仓库关联 UI**：在项目 Settings Tab 中添加 GitHub 仓库选择器，将选中仓库信息存入项目配置
- [ ] **Run 详情页 DAG 可视化**：当前 RunDetailPage 有数据但 DAG 图形渲染待实现（可用 reactflow 或 dagre）
- [ ] **Agent 执行端到端联调**：确保 codex-cli / claude-cli 安装后可以通过 UI 触发节点执行

## P1 — 体验优化

- [ ] **错误处理统一化**：API 请求失败时的 Toast 提示、Loading 状态
- [ ] **Sidebar 项目右键菜单**：重命名、打开文件夹、复制路径
- [ ] **深色主题一致性**：部分页面（Changelog/About）背景为白色，与 Sidebar 深色不协调
- [ ] **代码分割**：Vite 构建单 chunk 1.1MB 过大，对 pages 做 lazy import
- [ ] **移动端适配**：当前仅桌面端布局

## P2 — 长期规划

- [ ] **多人协作**：WebSocket 多客户端同步、乐观更新、冲突解决
- [ ] **权限系统**：基于 GitHub OAuth 的 RBAC 权限守卫
- [ ] **插件体系**：自定义 Agent 类型、自定义节点类型
- [ ] **执行历史回放**：Turn 级别的执行录像回放
- [ ] **数据库迁移**：从 JSON 文件迁移到 SQLite（当数据量增大时）
- [ ] **部署方案**：Docker 容器化、CI/CD 流程
- [ ] **测试覆盖**：单元测试 + E2E 测试（Vitest + Playwright）

## 已知问题 🐛

- Vite 8 要求 Node.js 20+，需要通过 nvm 切换（系统默认 Node 16 不兼容）
- 生产构建单 chunk 过大（1.1MB），需做代码分割
- WebSocket 连接频繁断开重连（可能与 Vite proxy 有关），需排查稳定性
- GitHub OAuth 需要配置环境变量，未配置时登录按钮点击会报错（需加友好提示）
