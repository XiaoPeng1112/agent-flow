# 新设备首次运行指南

> 记录于 2026-06-02，基于实际踩坑经验整理

## 快速启动步骤

```bash
# 1. 确认 Node.js 版本（需要 20+）
node -v
# 如果用 nvm：nvm use 20

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 GitHub OAuth 凭证（见下方说明）

# 4. 启动后端
npm run dev:server

# 5. 打开前端（GitHub Pages，无需本地启动）
open https://xiaopeng1112.github.io/agent-flow/
```

侧边栏底部出现**绿色状态灯**表示后端连接成功。

---

## 问题一：GitHub 登录失败，URL 中 client_id 为空

**现象**：点击登录跳转到 GitHub，URL 中 `client_id=` 为空，GitHub 直接拒绝。

**原因**：
1. 项目根目录没有 `.env` 文件（`.env` 在 `.gitignore` 中，不会随 git 同步）
2. `packages/server` 的 dev 脚本原本没有加载 `.env` 文件

**修复**：

`packages/server/package.json` 的 dev 脚本已改为：
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

> 注意：`.env.example` 中注释的 Callback URL 是 `http://localhost:3001/api/auth/github/callback`，这是错的。
> 实际应填写：`http://localhost:3001/api/auth/callback`（少了 `/github`）

---

## 问题二：Pull 提示"远端项目未匹配"

**现象**：登录后点击 Pull，提示：
```
Found 2 remote project(s) not matched locally: [agent-flow, frontend-interview-quiz].
Please clone the repo and add the project in AgentFlow first, then pull again.
```

**原因**：远端同步仓库里的项目数据是在 `gitRemote` 字段加入之前同步的（旧格式），没有 `gitRemote` 字段，导致跨设备自动匹配失败。

**解决**：
1. 在侧边栏手动添加两个项目，填入本地代码路径
2. 修复本地 `~/.agent-flow/projects.json` 中的项目 ID，与远端 ID 对齐（见下方）
3. 重启后端，再 Push 一次，把带 `gitRemote` 的数据写到远端

**ID 对齐说明**：新设备添加项目时会生成新 ID，但远端 runs 记录的是旧 ID，导致 runs 无法关联到项目。需要手动将本地 ID 替换为远端 ID：

```bash
# 查看远端项目 ID（需要已登录，auth.json 中有 accessToken）
node -e "
const fs = require('fs');
const auth = JSON.parse(fs.readFileSync(process.env.HOME + '/.agent-flow/auth.json', 'utf-8'));
const t = auth.accessToken;
fetch('https://api.github.com/repos/XiaoPeng1112/agent-flow-data/contents/users/XiaoPeng1112/projects.json', {
  headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github.v3+json' }
}).then(r => r.json()).then(d => {
  JSON.parse(Buffer.from(d.content, 'base64').toString()).forEach(p =>
    console.log(p.id, p.name)
  );
});
"
```

然后编辑 `~/.agent-flow/projects.json`，将本地生成的新 ID 替换为远端对应的旧 ID，重启后端。

---

## 问题三：Runs 列表可见但 Token 数据为空

**现象**：Pull 后 Runs 列表能显示，但每个 Run 内部的 Token 消耗、Agent 输出等数据为空白。

**原因**：这是一个已知的同步遗漏问题。`turns` 数据（包含 Token 统计和 Agent 输出）在 Push 时没有被序列化到 run 文件中，Pull 时自然也无法恢复。

**当前状态**：待修复（`sync.ts` Push/Pull 逻辑需要补充 turns 序列化）。

**影响范围**：仅影响跨设备同步场景。在原始设备上数据完整，新设备 Pull 后只能看到 Run 的结构和状态，看不到执行过程中的 Token 和输出详情。

---

## 注意事项

- `.env` 文件包含敏感凭证，**不要提交到 git**（已在 `.gitignore` 中）
- 每台新设备都需要手动创建 `.env`，但凭证内容是同一份（绑定在 GitHub OAuth App 上，不随设备变化）
- 首次在新设备 Pull 之前，务必先在 AgentFlow 中添加好所有项目，否则需要手动对齐 ID
