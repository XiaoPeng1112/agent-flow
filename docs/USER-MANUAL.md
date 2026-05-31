# AgentFlow 使用手册

> 版本：v2.5.0 | 更新日期：2026-05-31  
> 仓库：https://github.com/XiaoPeng1112/agent-flow  
> 在线演示：https://xiaopeng1112.github.io/agent-flow/

---

## 1. 项目简介

AgentFlow 是一个 AI 驱动的多 Agent 协作开发工作流引擎，核心定位为 **Agent 编排调度中心（Orchestrator）**。它连接本地终端、IDE 编辑器以及 Codex/Claude 等 AI 工具，实现从需求输入到代码交付的全流程闭环操作。

核心理念是 **MAF（Multi-Agent Flow）**——将软件开发拆解为多个角色（规划者、管理者、执行者），每个角色由专门的 Agent 承担，通过 DAG（有向无环图）编排实现高效协作。

---

## 2. 环境准备与安装

### 2.1 系统要求

- Node.js 20+（Vite 8 强制要求）
- Git（用于仓库隔离 worktree 功能）
- 推荐使用 nvm 管理 Node 版本

### 2.2 安装步骤

```bash
# 克隆项目
git clone https://github.com/XiaoPeng1112/agent-flow.git
cd agent-flow

# 切换 Node 版本
nvm use 20

# 安装依赖（Monorepo，一次安装前后端所有依赖）
npm install
```

### 2.3 环境变量配置（可选）

```bash
# GitHub OAuth 登录功能（需到 GitHub 创建 OAuth App）
export GITHUB_CLIENT_ID=your_client_id
export GITHUB_CLIENT_SECRET=your_client_secret

# 文件系统安全白名单（限制 Agent 可访问的目录，逗号分隔）
export ALLOWED_FILE_ROOTS=/path/to/project1,/path/to/project2
```

---

## 3. 启动与运行

### 3.1 开发模式

```bash
npm run dev
```

该命令会同时启动前后端：

| 服务 | 地址 | 说明 |
|------|------|------|
| 前端 | http://localhost:5173/agent-flow/ | Vite Dev Server + HMR |
| 后端 API | http://localhost:3001/api | Express REST API |
| WebSocket | ws://localhost:3001/ws | Agent 输出实时推送 |
| 健康检查 | http://localhost:3001/health | 服务状态检测 |

### 3.2 生产构建

```bash
# 构建前端
npm run build -w packages/client

# 部署到 GitHub Pages
npm run deploy
```

### 3.3 常见启动问题

**端口被占用**：如果看到 `EADDRINUSE` 错误，执行以下命令清理：

```bash
lsof -ti:3001 -ti:5173 | xargs kill -9
```

**HMR 不生效**：项目已配置 `usePolling` 模式（针对 macOS FSEvents 不触发的情况），如仍不生效，手动刷新浏览器（`Cmd+Shift+R`）。

**Node 版本不对**：Vite 8 需要 Node.js 20+，执行 `nvm use 20` 切换。

---

## 4. 核心概念

### 4.1 三层状态机

AgentFlow 的工作流采用三层嵌套状态机：

```
Run（工作流实例）
  └── Node（任务节点）
       └── Turn（Agent 执行轮次）
```

- **Run**：`created → running → completed / failed`
- **Node**：`pending → ready → running → wait_user_review → completed / skipped / failed`
- **Turn**：`idle → running → completed / error / paused`

### 4.2 DAG 编排

任务节点通过有向无环图（DAG）定义执行顺序。当一个节点的所有前置依赖完成后，自动进入 `ready` 状态。支持条件分支（EdgeCondition）实现动态路由。

### 4.3 多角色 Agent

| 角色 | 职责 | 典型工具 |
|------|------|----------|
| Planner | 需求拆解为可执行任务 | Claude CLI |
| Manager | 协调资源、分配节点 | Claude CLI |
| Executor | 调用 CLI 工具编写代码 | Codex CLI |

### 4.4 Context Chaining

节点执行前，引擎自动聚合所有前置节点的产出（Turn 输出 + Artifacts），作为当前节点的输入上下文。无需手动指定信息来源，DAG 拓扑自动决定上下文流向。

### 4.5 OutputContracts（产出物合同）

每个模板节点声明应产出什么（category + format + required），节点完成后系统自动校验 Agent 产出物是否满足合同。

---

## 5. 使用指南

### 5.1 创建项目

1. 打开浏览器访问 http://localhost:5173/agent-flow/
2. 侧边栏底部点击 **「+ 添加项目」**
3. 输入项目名称和本地路径
4. 项目创建后自动出现在侧边栏列表中

### 5.2 创建并运行工作流

1. 点击项目进入详情页，切换到 **Runs** 标签
2. 点击 **「新建 Run」**，选择工作流模板：
   - **标准 SDD 开发流程**：specify → design → task → implement → review → deliver
   - **快速功能迭代**：specify → implement → test → deliver
   - **Bug 修复流程**：specify → implement → test → deliver
   - **前后端并行开发**：specify → [implement-fe ∥ implement-be] → test → deliver
3. 创建后进入 Run 详情页（DAG 视图）
4. 在第一个 `ready` 节点中填写需求描述
5. 点击 **「启动执行」** 按钮触发 Agent 执行

### 5.3 节点操作

| 操作 | 说明 |
|------|------|
| 启动执行 | 触发 Agent 处理当前节点 |
| 验收通过 | 审核 Agent 产出后标记完成 |
| 打回重做 | 对产出不满意，要求 Agent 重新执行 |
| 跳过节点 | 跳过当前节点，后续节点自动就绪 |
| 取消执行 | 中断正在运行的 Agent 进程 |
| 强制重置 | 将节点状态强制恢复为 `ready` |
| 节点回滚 | 回滚到前一状态 |

### 5.4 查看 Skills

进入项目 → **Skills** 标签，查看系统自动扫描发现的 Skills 列表。扫描路径包括：

- 全局：`~/.catpaw/skills`、`~/.claude/skills`、`~/.codex/skills`
- 项目级：`项目目录/.catpaw/skills`、`项目目录/.claude/skills`

### 5.5 配置项目 Agent

进入项目 → **Agents** 标签，在顶部「项目 Agent 配置」卡片中：

1. 查看所有可用 Agent 列表（含 Provider 信息）
2. 通过 Switch 开关启用/禁用每个 Agent
3. 点击「保存配置」持久化

保存后，DAG 节点详情中的 Agent 下拉列表将自动过滤，仅展示当前项目已启用的 Agent。这样用户只需关注自己拥有 API Key 的 Provider。

### 5.6 GitHub 登录

侧边栏底部用户面板 → 点击 **「登录」** → 跳转 GitHub 授权 → 授权后自动返回并显示用户信息。

---

## 6. REST API 参考

所有 API 基础路径为 `http://localhost:3001/api`，响应格式统一为：

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "错误信息" }
```

### 6.1 项目管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/projects` | 获取所有项目列表 |
| POST | `/projects` | 创建项目 |
| PUT | `/projects/:id` | 更新项目（支持 enabledAgentIds） |
| DELETE | `/projects/:id` | 删除项目 |
| GET | `/projects/:id/enabled-agents` | 获取项目已启用的 Agent 列表 |
| PUT | `/projects/:id/enabled-agents` | 更新项目 Agent 启用配置 |

请求示例：

```json
PUT /api/projects/proj-001/enabled-agents
{
  "enabledAgentIds": ["codex-planner", "claude-executor", "claude-reviewer"]
}
// → { "success": true, "data": { "enabledAgentIds": [...] } }
```

当 `enabledAgentIds` 为 `undefined` 或未设置时，表示所有 Agent 均可用（向后兼容）。

### 6.2 工作流模板

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/templates` | 获取所有模板 |
| GET | `/templates/:id` | 获取模板详情 |
| POST | `/templates` | 创建自定义模板 |

### 6.3 Run 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/runs` | 获取所有 Run |
| POST | `/runs` | 创建 Run（需指定 templateId + projectId） |
| GET | `/runs/:id` | 获取 Run 详情（含所有节点和 Turn） |
| DELETE | `/runs/:id` | 删除 Run |
| POST | `/runs/:id/start` | 启动 Run |

### 6.4 节点操作

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/runs/:runId/nodes/:nodeId/start` | 启动节点 |
| POST | `/runs/:runId/nodes/:nodeId/approve` | 验收通过 |
| POST | `/runs/:runId/nodes/:nodeId/reject` | 打回重做 |
| POST | `/runs/:runId/nodes/:nodeId/skip` | 跳过节点 |
| POST | `/runs/:runId/nodes/:nodeId/reset` | 强制重置 |
| POST | `/runs/:runId/nodes/:nodeId/rollback` | 回滚 |

### 6.5 Agent 执行

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/runs/:runId/nodes/:nodeId/execute` | 启动 Agent 执行节点 |
| POST | `/runs/:runId/auto-execute` | 批量启动所有 ready 节点 |
| POST | `/turns/:turnId/cancel` | 取消正在执行的 Turn |

### 6.6 Repo Isolation（仓库隔离）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/repo-pool/workspace` | 创建隔离工作空间 |
| GET | `/repo-pool/status` | 获取仓库池状态 |
| DELETE | `/repo-pool/workspace/:workspaceId` | 释放工作空间 |

请求示例：

```json
POST /api/repo-pool/workspace
{
  "repoUrl": "https://github.com/user/project.git",
  "runId": "run-001",
  "strategy": "worktree"  // worktree | symlink | copy
}
```

### 6.7 Skill Materialization（Skill 物化）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/skills/materialize/:nodeId` | 获取节点的物化 Skill + Prompt |
| POST | `/skills/whitelist/:nodeId` | 设置节点 Skill 白名单 |
| GET | `/skills/whitelist/:nodeId` | 获取节点 Skill 白名单 |
| GET | `/skills/materialization-stats` | 获取物化统计 |

请求示例：

```json
POST /api/skills/whitelist/node-implement
{
  "allowedSkillIds": ["pdf", "xlsx", "browser"],
  "denySkillIds": ["skill-creator"]
}
```

### 6.8 Permission Isolation（权限隔离）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/permissions/policy` | 设置 Agent 权限策略 |
| GET | `/permissions/policy/:agentId/:runId` | 获取权限策略 |
| POST | `/permissions/check` | 权限检查 |
| GET | `/permissions/audit-log` | 获取审计日志 |

请求示例：

```json
POST /api/permissions/policy
{
  "agentId": "executor-1",
  "runId": "run-001",
  "repoAccess": ["project-*"],
  "filePatterns": {
    "allow": ["src/**/*.ts", "tests/**"],
    "deny": ["src/secrets/**"],
    "permissions": "read,write"
  }
}
```

```json
POST /api/permissions/check
{
  "agentId": "executor-1",
  "runId": "run-001",
  "resource": "src/components/App.tsx",
  "action": "write"
}
// → { "success": true, "data": { "allowed": true, "reason": "matched rule: src/**/*.ts" } }
```

### 6.9 A2A Protocol（Agent 间通信）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/a2a/send` | 发送消息 |
| POST | `/a2a/delegate` | 委派任务 |
| GET | `/a2a/inbox/:agentId` | 获取收件箱 |
| POST | `/a2a/pull/:agentId` | 拉取下一条待处理消息 |
| POST | `/a2a/ack/:messageId` | 确认消息已读 |
| POST | `/a2a/resolve/:messageId` | 解决/完成消息 |
| GET | `/a2a/stats` | 获取通信统计 |
| POST | `/a2a/channels` | 创建通信通道 |
| GET | `/a2a/messages/:runId` | 获取 Run 的所有消息 |

请求示例：

```json
POST /api/a2a/send
{
  "fromAgentId": "planner-1",
  "toAgentId": "executor-1",
  "runId": "run-001",
  "nodeId": "node-implement",
  "type": "request",
  "payload": { "task": "实现用户登录模块" },
  "priority": "high",
  "requiresAck": true
}
```

```json
POST /api/a2a/delegate
{
  "fromAgentId": "manager-1",
  "toAgentId": "executor-2",
  "runId": "run-001",
  "nodeId": "node-test",
  "task": { "description": "编写单元测试", "scope": "src/auth/**" },
  "priority": "normal"
}
```

### 6.10 Contract Validation（合同验证）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/runs/:runId/nodes/:nodeId/validate-contracts` | 验证节点产出物 |

响应示例：

```json
{
  "success": true,
  "data": {
    "result": {
      "nodeId": "node-implement",
      "passed": true,
      "matched": [
        { "contractId": "c1", "artifactId": "a1", "score": 1.0 }
      ],
      "missing": [],
      "extra": ["a2"]
    },
    "report": "✅ 合同验证通过：3/3 必需产出物已满足"
  }
}
```

### 6.11 Robustness（健壮性）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/robustness/health` | 系统健康状态 |
| GET | `/robustness/dead-letter` | 获取死信队列 |
| POST | `/robustness/dead-letter/:itemId/resolve` | 解决死信项 |
| GET | `/robustness/checkpoints/:runId` | 获取 Checkpoint 列表 |
| POST | `/robustness/checkpoints/:runId` | 创建 Checkpoint 快照 |
| GET | `/robustness/audit-log` | 查询审计日志 |

请求示例：

```json
POST /api/robustness/checkpoints/run-001
{
  "description": "implement 节点执行前快照"
}
```

### 6.12 其他 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/skills` | 获取所有 Skills |
| POST | `/skills/recommend` | 智能推荐 Skills |
| GET | `/git/status/:projectId` | 获取 Git 状态 |
| GET | `/git/commits/:projectId` | 获取 commit 列表 |
| GET | `/git/diff/:projectId` | 获取 diff |
| GET | `/auth/github` | GitHub OAuth 授权地址 |
| GET | `/auth/status` | 当前登录状态 |
| POST | `/auth/logout` | 退出登录 |
| GET | `/health` | 健康检查 |

---

## 7. WebSocket 事件

连接地址：`ws://localhost:3001/ws`

### 7.1 服务端推送事件

| 事件类型 | 说明 |
|----------|------|
| `turn_output` | Agent 实时输出流（逐 chunk 推送） |
| `turn_completed` | Agent 执行完成（含 token 统计） |
| `turn_error` | Agent 执行出错 |
| `node_status_changed` | 节点状态变更 |
| `run_status_changed` | Run 状态变更 |

### 7.2 消息格式

```json
{
  "type": "turn_output",
  "data": {
    "turnId": "turn-xxx",
    "nodeId": "node-implement",
    "runId": "run-001",
    "content": "正在分析需求..."
  }
}
```

---

## 8. 数据存储

所有数据以 JSON 文件持久化存储在用户目录下：

| 文件路径 | 内容 |
|----------|------|
| `~/.agent-flow/projects.json` | 项目列表 |
| `~/.agent-flow/templates.json` | 工作流模板 |
| `~/.agent-flow/runs/index.json` | Run 历史记录 |
| `~/.agent-flow/auth.json` | OAuth 认证信息 |

---

## 9. 项目结构

```
agent-flow/
├── packages/
│   ├── client/              # 前端 React 19 + Vite 8 + Tailwind v4
│   │   └── src/
│   │       ├── api/         # REST API 客户端封装
│   │       ├── components/  # UI 组件（detail/ layout/ sidebar/）
│   │       ├── pages/       # 路由页面
│   │       ├── store/       # Zustand 状态管理
│   │       └── types/       # TypeScript 类型
│   └── server/              # 后端 Express 5 + WebSocket
│       └── src/
│           ├── index.ts             # 服务入口 (v2.4.0)
│           ├── routes/api.ts        # REST API 路由
│           ├── services/            # 业务服务层（15 个模块）
│           └── types/index.ts       # 核心类型定义
├── docs/                    # 文档（本手册）
├── .agent-flow/context/     # 项目上下文文档
└── scripts/                 # 工具脚本
```

---

## 10. 部署指南

### 10.1 GitHub Pages 部署

```bash
# 一键构建 + 部署
npm run deploy
```

该命令执行：
1. 构建前端（`tsc -b && vite build`）
2. 复制 `index.html` 为 `404.html`（SPA 路由兼容）
3. 通过 gh-pages 推送 `dist/` 到 GitHub Pages

部署后访问：https://xiaopeng1112.github.io/agent-flow/

### 10.2 架构说明

AgentFlow 采用**前端部署 + 本地后端**架构：

- 前端可部署在任何静态托管服务（GitHub Pages、Vercel、Netlify）
- 后端必须在用户本机运行（需访问本地文件系统和 CLI 工具）
- 浏览器中的前端直接连接 `localhost:3001`

因此，即使通过 GitHub Pages 访问前端，也需要在本地启动后端服务：

```bash
cd agent-flow && nvm use 20 && npm run dev
```

---

## 11. 安全机制

| 机制 | 说明 |
|------|------|
| 文件系统白名单 | `ALLOWED_FILE_ROOTS` 限制可访问目录，路径穿越防护 |
| OAuth CSRF 防护 | state 参数随机值 + 10 分钟 TTL |
| WebSocket 防泄漏 | ManagedWS dispose 标志位防止递归重连 |
| Agent 取消安全 | cancelledTurns Set 防止 close handler 重复提交 |
| 权限隔离 | RBAC deny-by-default + glob 文件访问规则 |
| 仓库隔离 | Git worktree 池化防止并行 Run 文件冲突 |
| 数据持久化 | 所有状态变更 async/await persist() |
| 启动恢复 | 自动重置孤儿 running 节点 |

---

## 12. 开发指南

### 12.1 添加新的服务模块

1. 在 `packages/server/src/services/` 创建服务文件
2. 在 `packages/server/src/types/index.ts` 添加相关类型
3. 在 `packages/server/src/index.ts` 实例化服务并注入依赖
4. 在 `packages/server/src/routes/api.ts` 的 `createApiRouter` 中添加 API 路由
5. 运行 `npx tsc --noEmit` 确认编译通过

### 12.2 添加新的前端页面

1. 在 `packages/client/src/pages/` 创建页面组件
2. 在 `packages/client/src/router/` 添加路由配置
3. 如需后端交互，在 `packages/client/src/api/` 添加 API 方法

### 12.3 调试技巧

```bash
# 仅启动后端（带 watch 热更新）
npm run dev:server

# 仅启动前端
npm run dev:client

# TypeScript 类型检查
cd packages/server && npx tsc --noEmit
cd packages/client && npx tsc --noEmit
```

### 12.4 运行测试

```bash
# 运行全部单元测试（需要 Node 20+）
cd packages/server && npm test

# Watch 模式（文件变更自动重跑）
npm run test:watch

# 生成覆盖率报告
npm run test:coverage
```

---

## 13. 故障排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 红色“后端服务未连接”横幅 | 后端未启动 | 执行 `npm run dev` |
| 前端显示空白 | Node.js 版本过低 | `nvm use 20` |
| EADDRINUSE 端口冲突 | 旧进程未退出 | `lsof -ti:3001 \| xargs kill -9` |
| HMR 不生效 | FSEvents 不触发 | 已配置 usePolling，硬刷新 `Cmd+Shift+R` |
| Agent 执行无响应 | codex-cli/claude-cli 未安装 | 安装对应 CLI 工具 |
| GitHub 登录报错 | 未配置 OAuth 环境变量 | 设置 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET` |
| 构建 vendor chunk 过大警告 | antd 体积较大 | 可忽略，页面已通过 React.lazy 独立拆分 |
| Vitest 报错 styleText | Node.js 版本过低 | 需要 Node 20+，`nvm use 20` |

---

## 14. 版本历史

| 版本 | 日期 | 重点 |
|------|------|------|
| v2.5.0 | 2026-05-31 | Per-Project Agent 配置（项目级 Agent 启用/禁用 + DAG 节点过滤） |
| v2.4.1 | 2026-05-31 | 工程质量提升（代码分割 / ErrorBoundary / useRequest / Vitest） |
| v2.4.0 | 2026-05-30 | MAF 六大服务模块（Repo/Skill/Permission/A2A/Contract/Robustness） |
| v2.3.1 | 2026-05-30 | 模板补全 + 异步安全修复 |
| v2.3.0 | 2026-05-30 | 安全加固 + DAG 增强 + AI 开发流程优化 |
| v2.2.0 | 2026-05-29 | 后端状态监测 + GitHub Pages 部署 |
| v2.1.0 | 2026-05-29 | 企业级路由 + GitHub OAuth |
| v2.0.0 | 2026-05-29 | MAF 工作流引擎 MVP |
| v1.0.0 | 2026-05-29 | 项目初始化 |

---

## 15. 建议与后续规划

基于当前项目状态，以下是软件工程角度的优化建议：

### 短期（✅ v2.5.0 已全部完成）

- ✅ **Per-Project Agent 配置**：项目级 Agent 启用/禁用，DAG 节点自动过滤
- ✅ **代码分割**：React.lazy + Suspense 路由级分割，页面 chunk 独立拆分
- ✅ **单元测试**：Vitest 68 cases 覆盖 WorkflowEngine、A2AProtocol、ContractValidator
- ✅ **错误边界**：React ErrorBoundary 全局错误隔离，防止白屏扩散
- ✅ **API 请求错误统一处理**：useRequest Hook（Toast + Loading + 指数退避重试）

### 中期

- **Run 详情页 DAG 可视化**：集成 ReactFlow 或 dagre 实现节点图形渲染
- **数据库迁移**：项目/Run 数据量增大后从 JSON 文件迁移到 SQLite
- **A2A 前端可视化**：在 Run 详情页展示 Agent 间消息流转拓扑
- **Checkpoint 恢复 UI**：支持用户从快照恢复中断的 Run

### 长期

- **多人协作**：WebSocket 多客户端同步 + 乐观更新 + 冲突解决
- **插件体系**：支持自定义 Agent 类型和节点类型
- **Docker 容器化**：标准化开发和部署环境
- **E2E 测试**：Playwright 覆盖核心用户路径

---

## 许可证

MIT License - 详见 [LICENSE](../LICENSE)
