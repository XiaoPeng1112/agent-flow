# .agent-flow/context/

本目录存储 AgentFlow 项目的**开发上下文信息**，用于在切换 AI 对话时快速恢复项目认知。

## 文件说明

| 文件 | 内容 | 更新频率 |
|------|------|----------|
| `ARCHITECTURE.md` | 项目架构、技术栈、目录结构、运行方式 | 架构变更时 |
| `DECISIONS.md` | 关键技术决策记录（ADR 格式） | 每次重要决策时 |
| `DEVLOG.md` | 开发过程日志（按日期） | 每次开发会话后 |
| `TODO.md` | 待办事项、优先级、已知问题 | 任务变更时 |

## 使用方式

### 新对话开始时

告诉 AI 助手：

> 请读取 `.agent-flow/context/` 目录下的所有文件来了解项目上下文。

或更精确地：

> 读取 .agent-flow/context/ARCHITECTURE.md 和 TODO.md，我要继续开发 AgentFlow。

### 开发会话结束时

**方案 A（推荐）**：告诉 AI 助手 "同步 context"，AI 会自动将本次变更写入对应文档。

**方案 B（自动检查）**：运行同步检查脚本，查看哪些文档需要更新：

```bash
npm run sync-context
```

手动更新对应文档：
- 架构变动 → 更新 ARCHITECTURE.md
- 新的技术决策 → 追加到 DECISIONS.md
- 开发记录 → 追加到 DEVLOG.md
- 任务进展 → 更新 TODO.md

### 多人协作

- 本目录纳入 Git 版本控制，随代码一起推送
- 修改通过 commit + PR review 流程
- 冲突解决走 Git 标准 merge 流程
- 建议每人在 DEVLOG.md 中标注自己的 MIS/GitHub ID
