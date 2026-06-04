# 待办与后续计划

> 按优先级排列，P0 = 必须做，P1 = 应该做，P2 = 可以做  
> 最后更新：2026-06-06（v2.11.0）

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
- [x] Vitest 单元测试（128 cases 覆盖核心服务）
- [x] 产出物闭环（ArtifactMergeService：Git worktree Diff Review + Squash/Merge/Rebase）
- [x] 可观测性增强（MetricsCollector：时间/Token/质量指标采集 + 效率评分 + 持久化）
- [x] Diff Review 前端面板（GitHub PR 风格文件树 + 行级 Diff + 合并/丢弃操作）
- [x] Metrics 前端面板（Overview/Timeline/Token Distribution/Efficiency 四视图）
- [x] Per-Project Agent 配置（项目级 Agent 启用/禁用 + DAG 节点过滤）
- [x] Context DB 四层体系闭环（System/L1/L2/L3 + 模板声明式重构）
- [x] SQLite + WAL 持久化迁移 + WorkflowEngine Facade 拆分 + 路由模块化
- [x] GitHub Private Repo 数据同步 + 多用户隔离 + gitRemote 跨设备匹配
- [x] FeedbackCollector + WeeklyDigest 反馈闭环
- [x] GitHub PR 工作流 + 仓库类型自动检测
- [x] Skill 自动沉淀系统（5 维评分引擎 + Jaccard 去重 + 事件驱动）
- [x] AutoFlow 自动审批引擎（7 信号信心评估 + 自适应学习 + 安全阀）
- [x] ValidationTurnService（script/contract/llm/composite 四策略验证）
- [x] L1RuleLifecycleService（draft→active→decaying→deprecated→archived 状态机）
- [x] 6 个新前端面板（AutoFlow/WeeklyDigest/L1Rule/Validation/MergeConflict/FeedbackAggregate）
- [x] **AdversarialTurnService**（节点内多 Agent 对抗：coder→reviewer→fix loop + 质量信号接入 AutoFlow）
- [x] **Sub-Turn 类型体系**（SubTurn/AdversarialSession/AdversarialResult + TemplateNode.adversarial 配置）
- [x] **AutoFlow 8 信号扩展**（adversarialScore 作为第 8 信号，权重 0.15，动态借用 + 信号学习）
- [x] **AgentCard Registry**（标准化 Agent 描述符 + 能力推断 + 基于权重的智能路由 findBestForTask）
- [x] **AgentCard REST API**（GET /cards, /cards/query/capability, POST /cards/find-best, GET /cards/:id）
- [x] **DynamicAgentFactory 能力路由升级**（resolveBaseAgent 优先走 AgentCard 路由，回退传统角色匹配）
- [x] **前端 Sub-Turn 可视化面板**（SubTurnPanel：节点对抗会话/Round 分组时间线/verdict+feedback 展示）
- [x] **A2A 面板 Sub-Turn Flow 视图**（统一时间线：Sub-Turn + progress_report 消息按时间排序展示）
- [x] **Adversarial REST API**（后端 /adversarial/* 路由：sessions/session/result/active 4 端点）

---

## P0 — 核心扩展方向

### 背景

A2A 协议层（A2AProtocolService，435 行）功能完备——消息发送/接收/确认/解决/过期/重试/通道广播全部实现，REST API 也已暴露。AdversarialTurnService 已通过 A2A 发送 delegateTask/deliverTask 消息，初步激活了管道。但当前 AutoFlow 启动主节点时仍直接走 DynamicAgentFactory.createInstance → startTurnAsync，尚未经过 A2A 路由层。

多 Agent 对抗机制（coder+reviewer+tester 交叉验证）的后端已实现，接下来需要完成前端可视化和 A2A 全链路贯通。

### P0-1：节点内多 Agent 对抗机制（Sub-Turn 编排）  ✅ 完成

- [x] **设计 Sub-Turn 概念**：一个节点的 Turn 内部包含多个 Sub-Turn（coder-turn → reviewer-turn → fix-turn），由 AdversarialTurnService 编排
- [x] **实现 AdversarialTurnService**：编排 coder → reviewer → (tester) 的对抗 loop，最多 N 轮（默认 3）
- [x] **Reviewer Sub-Agent**：独立上下文、独立 roleStatement（"你是严格的代码审查员，只审不改"），读取 coder 产出物做 Code Review
- [x] **Tester Sub-Agent**：可选，基于独立 LLM Turn 产出测试用例
- [x] **对抗结果接入 AutoFlow 信号**：adversarialScore 作为第 8 信号（权重 0.15）
- [x] **前端 Sub-Turn 可视化**：SubTurnPanel 面板 — 节点选择器 + 会话卡片 + Round 分组 Collapse 时间线 + verdict/feedback/tokenUsage
- [x] **Agent close handler 集成**：AgentService.injectAdversarial() 已在 Turn 完成回调中自动触发 adversarial

### P0-2：A2A 协议全链路贯通  ✅ 完成

- [x] **AutoFlow autoStart 接入 A2A**：节点 ready 时通过 `a2aProtocol.delegateTask()` 发消息给 DynamicAgentFactory，而非直接调用
- [x] **Sub-Turn 通过 A2A 通信**：AdversarialTurnService 已通过 delegateTask/deliverTask 发送审查/交付消息
- [x] **进度汇报**：Sub-Agent 执行中通过 `reportProgress` 向 Manager 汇报进度（前端可展示）
- [x] **A2A 前端面板升级**：新增 "Sub-Turn" 视图模式 — 统一时间线展示 Sub-Turn + progress_report 消息流

### P0-3：AgentCard 标准化声明  ✅ 完成

- [x] **定义 AgentCard interface**：聚合 Agent 的角色声明、能力范围、Provider 绑定、上下文 Scope、通信端点
- [x] **从散落配置统一到 AgentCard**：AgentService 内 agentCards Map，registerAgent 时自动 buildCardFromConfig
- [x] **基于 AgentCard 的寻址机制**：findBestForTask 加权评分（role +10, capability×strength×8, nodeType +5, CLI available +20/-100）
- [x] **AgentCard REST API**：4 端点完备（列表/能力查询/智能路由/单卡详情）
- [x] **DynamicAgentFactory 集成**：resolveBaseAgent 优先走 AgentCard 路由，回退传统角色匹配

---

## P1 — 架构优化

### P1-1：上下文 Scope 隔离

- [ ] **TemplateNode 增加 contextScope 配置**：`{ includeL1: string[], excludeL1: string[] }`
- [ ] **DynamicAgentFactory 创建实例时按 scope 过滤注入上下文**：严格隔离，Agent 只看到自己 scope 内的知识
- [ ] **解决注意力稀释问题**：跨域需求中不同节点的 Agent 不被无关上下文干扰

### P1-2：设计阶段 Agent 讨论机制（Discussion Turn）

- [ ] **design 节点并行派发**：多个角色并行产出局部设计
- [ ] **问题池收集**：各 Agent 产出"未确认问题"汇总
- [ ] **主控分诊路由**：问题分诊后通过 A2A broadcast 路由给能回答的 Agent
- [ ] **结论合并**：收到答案后合并更新最终设计产物

### P1-3：Partner 模式（柔性协作）

- [ ] **consultPeer 轻量咨询**：Agent 执行中遇到跨域问题，通过 A2A 向同 Run 内其他 Agent 发起咨询
- [ ] **不启动完整 Turn**：在当前 Turn 内插入一次问答，比重新拉 Turn 轻量得多
- [ ] **利用 A2A Channel broadcast**：天然适合 Partner 模式

### P1-4：Agent 生命周期标准化

- [ ] **AgentLifecycleState 枚举**：idle / starting / running / paused / error / terminated
- [ ] **Turn 五阶段协议**：StartTurn → RecordResult → Finalize → Commit → Cleanup
- [ ] **Stop Hook 兜底**：timeout + forceFinalizeIfMissing，防止模型漏调 turn-result 导致系统卡住

---

## P1 — 体验优化（原有）

- [ ] **GitHub OAuth 前端完整流程**：OAuth 回调页面处理
- [ ] **GitHub 仓库关联 UI**：在项目 Settings Tab 中添加 GitHub 仓库选择器
- [ ] **Agent 执行端到端联调**：确保 codex-cli / claude-cli 安装后可通过 UI 触发执行
- [ ] **Sidebar 项目右键菜单**：重命名、打开文件夹、复制路径
- [ ] **深色主题一致性**：部分页面背景与 Sidebar 深色不协调

---

## P2 — 长期规划

### P2-1：知识自动沉淀闭环

- [ ] **Run 结束后自动提取人工补充的知识**：扫描 user_input 类型 A2A 消息和 human feedback
- [ ] **自动生成候选 Context 条目（draft 状态）**：人确认后正式沉淀到 ContextDB
- [ ] **让知识库从"人工维护"变"半自动增长"**

### P2-2：接入外部 Agent 编排平台

- [ ] **Agent 与编排层解耦**：对外提供可复用的 Agent，方便切换编排框架
- [ ] **通过 AgentCard 标准化实现统一接入**：Multica / 飞象 / CatClaw 等平台适配

### P2-3：原有长期规划

- [ ] **多人协作**：WebSocket 多客户端同步、乐观更新、冲突解决
- [ ] **插件体系**：自定义 Agent 类型、自定义节点类型
- [ ] **执行历史回放**：Turn 级别的执行录像回放
- [ ] **Docker 容器化**：CI/CD 流程
- [ ] **E2E 测试**：Playwright 覆盖核心用户路径
- [ ] **Context Chaining 可视化**：在 DAG 视图中显示节点间的上下文传递关系

---

## 已知问题 🐛

- Vite 8 要求 Node.js 20+，需要通过 `nvm use --delete-prefix v20.19.2` 切换
- GitHub OAuth 需要配置环境变量，未配置时登录按钮点击会报错（需加友好提示）
- `tsx watch` 仅监听 server 端代码变更，client 端依赖 Vite HMR 独立热更新

---

## 后续提升方向（基于当前系统能力分析）

当前系统已具备完整的单节点执行链路和自动化审批能力，下表列举基于现有架构可进一步提升的方向：

| 方向 | 当前状态 | 提升路径 | 优先级 |
|------|----------|----------|--------|
| 多 Agent 协作深度 | ✅ 前后端对抗可视化完成 | 三角色策略实战验证 + 更多场景覆盖 | P1 |
| A2A 协议利用率 | ✅ autoStart + reportProgress + 前端面板全链路完成 | 跨 Run A2A 消息流转 + 外部 Agent 接入 | P2 |
| Agent 寻址与发现 | ✅ AgentCard + findBestForTask 完成 | 跨 Run 共享 AgentCard 缓存 + 外部 Agent 注册 | P2 |
| 上下文精度 | 所有同层 L1 规则全量注入，无法按节点过滤 | contextScope 隔离，减少注意力稀释 | P1 |
| 设计阶段质量 | 单 Agent 串行设计，视角单一 | 多 Agent 并行讨论 + 问题池 + 分诊合并 | P1 |
| 轻量级跨域协作 | 需要完整 Turn 流转才能获取其他 Agent 知识 | Partner 模式 consultPeer 一问一答 | P1 |
| Agent 生命周期健壮性 | 依赖 Agent CLI 进程退出码判断完成 | 标准化 5 阶段协议 + Stop Hook 超时兜底 | P1 |
| 知识自演进 | 依赖人工维护 ContextDB | Run 过程中自动提取知识候选 + 人确认沉淀 | P2 |
| 平台可移植性 | 与 AgentFlow 编排层耦合 | 通过 AgentCard 抽象层接入外部编排平台 | P2 |
