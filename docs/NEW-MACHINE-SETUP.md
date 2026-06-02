# 新设备首次运行指南

> 记录于 2026-06-02，基于实际踩坑经验整理

## 快速启动步骤

```bash
# 1. 确认 Node.js 版本（需要 20+，Vite 8 不支持 Node 16/18）
source ~/.nvm/nvm.sh && nvm use 20
node -v  # 确认输出 v20.x

# 2. 克隆项目 & 安装依赖
git clone https://github.com/XiaoPeng1112/agent-flow.git
cd agent-flow
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 GitHub OAuth 凭证（见下方说明）

# 4. 启动后端服务
npm run dev:server

# 5. 打开前端（GitHub Pages，无需本地启动）
open https://xiaopeng1112.github.io/agent-flow/
```

侧边栏底部出现**绿色状态灯**表示后端连接成功。

---

## 数据同步流程（v2.7.2+）

新设备首次同步只需三步：

1. **在本地 clone 好所有需要同步的项目代码**（确保有 `.git` 目录）
2. **在 AgentFlow 侧边栏添加这些项目**（系统会自动通过 `git remote get-url origin` 探测 gitRemote 字段）
3. **点击 Pull 同步数据**（系统会自动通过 gitRemote 匹配远端项目，将本地临时 ID 替换为远端全局 ID）

如果匹配失败（比如非 Git 项目），Pull 会提示未匹配的项目列表，可通过 pathMapping API 手动指定映射。

---

## 常见问题

### 问题一：GitHub 登录失败，URL 中 client_id 为空

**现象**：点击登录跳转到 GitHub，URL 中 `client_id=` 为空，GitHub 直接拒绝。

**原因**：项目根目录没有 `.env` 文件（`.env` 在 `.gitignore` 中，不会随 git 同步）。

**修复**：

`packages/server/package.json` 的 dev 脚本会从项目根目录加载 `.env`：
```json
"dev": "tsx watch --env-file=../../.env src/index.ts"
```

所以只需要在项目根目录创建 `.env` 并填入凭证即可，**每台新设备都需要手动创建一次**。

**获取凭证**：进入 [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)，找到已有的 `AgentFlow` 应用，复制 Client ID 和 Client Secret。

`.env` 内容：
```
GITHUB_CLIENT_ID=（从 GitHub OAuth App 复制）
GITHUB_CLIENT_SECRET=（从 GitHub OAuth App 复制）
```

**Callback URL 配置**：GitHub OAuth App 中的 Authorization callback URL 应填写：
```
http://localhost:3001/api/auth/callback
```

这与 `.env.example` 中的注释一致。

---

### 问题二：Pull 提示"远端项目未匹配"

**现象**：登录后点击 Pull，提示：
```
Found 2 remote project(s) not matched locally: [agent-flow, frontend-interview-quiz].
Please clone the repo and add the project in AgentFlow first, then pull again.
```

**原因**：本地还没有添加对应的项目，或者远端项目数据是 v2.7.2 之前同步的（没有 `gitRemote` 字段），导致自动匹配失败。

**解决**（v2.7.2+ 标准流程）：
1. 确保在本地 clone 好对应的项目代码
2. 在 AgentFlow 侧边栏添加这些项目（系统会自动探测 gitRemote）
3. 再次点击 Pull，系统会通过 `normalizeGitRemote()` 自动匹配

**如果远端数据没有 gitRemote 字段（旧格式）**：
1. 先按上述步骤添加项目并 Pull（此时本地项目已带有 gitRemote）
2. 再 Push 一次，把带 `gitRemote` 的完整数据写到远端
3. 后续其他设备 Pull 时就能自动匹配了

**非 Git 项目的兜底方案**（pathMapping）：
```bash
# 设置路径映射：远端项目 ID → 本地路径
curl -X POST http://localhost:3001/api/sync/path-mapping \
  -H "Content-Type: application/json" \
  -d '{"projectId": "远端项目ID", "localPath": "/本地/项目/路径"}'
```

---

### 问题三：Runs 列表可见但 Token 数据为空（已修复）

**现象**：Pull 后 Runs 列表能显示，但每个 Run 内部的 Token 消耗、Agent 输出等数据为空白。

**原因**：`turns` 数据（包含 Token 统计和 Agent 输出）在 Push 时没有被序列化到 run 文件中，Pull 时自然也无法恢复。

**修复**：Push 时每个 run 文件附带 `_turns` 字段（通过 `getRunTurns()` 收集该 Run 所有节点的 turns），Pull 时 `mergeRun()` 提取 `_turns` 传入 `importRun()` 写入本地 turns 存储。

**注意**：修复前已推送到远端的 run 数据不包含 turns。需要在原始设备（数据完整的设备）上重新 Push 一次，将含 turns 的完整数据写到远端，其他设备再 Pull 即可恢复。

---

## 注意事项

- `.env` 文件包含敏感凭证，**不要提交到 git**（已在 `.gitignore` 中）
- 每台新设备都需要手动创建 `.env`，但凭证内容是同一份（绑定在 GitHub OAuth App 上，不随设备变化）
- 首次 Pull 前，务必先在 AgentFlow 中添加好所有项目（确保本地有 `.git` 目录以便自动探测 gitRemote）
- 启动后端前必须执行 `nvm use 20`，否则 tsx/Vite 可能因 Node 版本过低报错
