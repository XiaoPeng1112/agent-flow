# AgentFlow 优化清单（对标 MRF 设计文档）

> 基于 MRF 顶层设计文档与当前实现的差距分析  
> 创建时间：2026-05-30  
> 状态：✅ 已完成 / 🚧 进行中 / ⬜ 待做

---

## 第一优先级：直接影响使用体验（已完成 ✅）

### 1. ✅ 节点实时计时器
- **问题**：DAG 节点执行过程中无耗时显示，用户无法判断进度
- **方案**：在 DAG 卡片上，running 时显示实时计时（每秒刷新），completed 后显示总耗时
- **MRF 对标**：§12 本机资源监控 — "运行时长必须在 UI 中可见"

### 2. ✅ 审批交互优化（修改后继续）
- **问题**：wait_user_review 时只有"确认通过"和"打回重做"，小修改也要整个节点重来，浪费 token
- **方案**：新增"修改后继续"按钮，用户填写修改意见后 approve，意见作为 artifact 通过 Context Chaining 传递到后续节点
- **MRF 对标**：§11 Ops Console — "rebuild context / rerun / 受控人工干预"

### 3. ✅ Token 统计面板
- **问题**：前端无 Token 累计展示；后端 parseTokenUsage 正则不匹配 Codex 实际输出格式
- **方案**：修复正则匹配 `(68350 tokens)` 格式；Run 头部新增 Token 统计徽章（定期轮询 `/token-stats` API）
- **MRF 对标**：§4.4 Run Overview — "token / 时间 / 系统资源"

---

## 第二优先级：提升产品感

### 4. ✅ Agent 输出结果展示
- **问题**：wait_user_review 时右侧面板无法看到 Agent 的完整输出，用户难以判断质量
- **方案**：审批面板中嵌入 AgentResultPreview，支持 Markdown 渲染（react-markdown + remark-gfm） + 代码高亮（react-syntax-highlighter + oneDark 主题），MD/TXT 模式切换、一键复制、展开/收起
- **MRF 对标**：§4.7 Agent Detail — "执行日志 / tool 调用 / artifacts"
- **预估工时**：0.5 天 | AI 辅助：2-3 小时

### 5. ✅ 真正的 DAG 图形化
- **问题**：当前是垂直列表，无法表达并行分支（parallel-dev 模板），不直观
- **方案**：引入 `@xyflow/react`，自定义 DAGCustomNode 组件，拓扑分层自动布局，状态着色边 + 动画，支持拖拽平移和缩放
- **MRF 对标**：§4.5 DAG Explorer — "Task DAG / Repo DAG / 节点状态"
- **预估工时**：2-3 天 | AI 辅助：1-1.5 天

### 6. ✅ Run Overview 信息增强
- **问题**：头部只有名称和状态，缺少运行概要
- **方案**：新增 Overview 信息栏：带颜色的进度条、当前阶段指示器（执行中/待验收/就绪）、完成率、活跃 Agent 数、总耗时显示
- **MRF 对标**：§4.4 Run Overview — "当前阶段 / 主 Agent 摘要 / token-时间-资源"
- **预估工时**：1 天 | AI 辅助：3-4 小时

### 7. ✅ 多 Provider 配置面板
- **问题**：Agent 列表只有名称和可用性，缺少配置管理
- **方案**：在 Agents 面板新增 ProviderConfigPanel 组件，展示 Codex/Claude/自定义 CLI 三大 Provider 的可用性、默认配置预览、环境变量配置（支持 password 类型）、启用/禁用开关
- **MRF 对标**：§4.9 Runtime Registry — "provider 可用性 / 默认配置与覆盖"
- **预估工时**：2 天 | AI 辅助：0.5-1 天

---

## 第三优先级：向 MRF 架构演进

### 8. ⬜ 确定性执行层（DET 模式）
- **问题**：所有节点都通过 LLM Agent 执行，某些简单任务（跑测试、lint）浪费 token
- **方案**：模板节点定义增加 `executionMode: 'det' | 'hyb' | 'llm'`，DET 模式直接执行脚本
- **MRF 对标**：§2.1 代码优先，推理兜底 — "凡是确定性代码能做的，用代码实现"
- **预估工时**：3-4 天 | AI 辅助：1-2 天

### 9. ✅ 动态 Agent 创建
- **问题**：Agent 预注册为静态全局实例，上下文不会针对任务动态装配
- **方案**：每个节点执行前，根据角色 + 模板 + context 动态创建 Agent 实例，注入 scoped context
- **实现**：`packages/server/src/services/dynamic-agent-factory.ts` — 按角色动态创建实例，生命周期跟随 Run
- **MRF 对标**：§6.3 实时创建原则 — "不是静态常驻角色 / 不是预先固定上下文"
- **完成日期**：2026-05-31

### 10. ✅ Context DB 基础版
- **问题**：上下文只通过 prompt 拼接，无结构化管理
- **方案**：实现 SYS/L0/L1/L2 四层 context 文件管理 UI + 装配引擎
- **实现**：
  - 后端：`packages/server/src/services/context-db.ts` — 四层文件 CRUD + 装配引擎
  - 前端：`ContextDBPanel.tsx` — 层级 Tab、文件列表、编辑器、装配预览
- **MRF 对标**：§8 精准上下文数据库 — "四层模型 + 装配顺序"
- **完成日期**：2026-05-31

### 11. ✅ Agent Tree 可视化
- **问题**：无主 Agent / 子 Agent 树形展示
- **方案**：新增 Agent Tree 页面，主 Agent 在根部，子 Agent 按角色和 repo 展开
- **实现**：`AgentTreePanel.tsx` — 树形结构展示，按角色（planner/manager/executor）分组，显示实例状态、关联节点、创建时间
- **MRF 对标**：§4.6 Agent Tree — "主 Agent 在树根 / 子 Agent 按角色和 repo 展开"
- **完成日期**：2026-05-31

### 12. ✅ Checkpoint 恢复 UI
- **问题**：后端有 Checkpoint 服务但前端无恢复操作入口
- **方案**：Run 详情页新增"从快照恢复"操作，展示可用的 checkpoint 列表
- **实现**：`CheckpointPanel.tsx` — Timeline 展示快照列表、创建/恢复快照、系统健康状态监控（死信队列/待重试/审计日志）
- **MRF 对标**：§2.5 实时可观测 — "checkpoint / 人工干预 / 恢复"
- **完成日期**：2026-05-31

---

## 已完成补充项

### 13. ✅ Per-Project Agent 配置（项目级 Agent 启用/禁用）
- **问题**：所有 Agent 对所有项目全局可见，但用户不一定拥有所有 Provider 的 API Key，DAG 节点选择 Agent 时列表过长
- **方案**：
  - 类型层：`Project` 新增 `enabledAgentIds?: string[]` 字段（undefined 表示全部启用，向后兼容）
  - Server API：`GET/PUT /api/projects/:id/enabled-agents` 端点
  - 前端 AgentsPanel：新增 `ProjectAgentConfig` 组件，Switch 开关逐个控制启用/禁用，保存后同步全局 Store
  - DAG 节点详情：RunDetail 中根据当前项目的 `enabledAgentIds` 过滤 agents 列表再传入 NodeDetailPanel
- **MRF 对标**：§4.9 Runtime Registry — "provider 可用性 / 启用/禁用控制"
- **完成日期**：2026-05-31

---

## 参考文档

- 项目仓库：https://github.com/XiaoPeng1112/agent-flow
- 前端访问：https://xiaopeng1112.github.io/agent-flow/
