# AgentFlow 全项目 Code Review — 2026-09-06

修复状态：以下 13 项已完成代码修复，详见 [修复记录](CR-FIXES-2026-09-06.md)。本文保留修复前审查证据；最终验证结果见升级进度第五批。

修复前审查结论：当前工作区存在 6 项 P1、7 项 P2，建议先修复这些问题再合入升级。问题包含既有逻辑缺陷，也包含新工作区、完成门禁、worker 和实时同步接入后产生的回归。现有测试通过不足以证明这些模块已经形成完整闭环。

本次以当前全部工作区代码为对象，覆盖执行/恢复、DAG 与节点操作、SQLite、验证与交付、跨设备同步、前端操作和实时状态；同时检查相关 API、权限边界、provider 协议实现与现有测试。本轮没有修改业务代码。以下只列有明确调用链或复现证据的问题，不把尚未实现的容器隔离、全局配额等规划项当作缺陷凑数。

P1 表示应优先修复的数据完整性、服务退出或核心交付阻塞；P2 表示需要修复的功能或一致性问题。

## 1. [P1] 同步把“未同步过的任务”误判为删除，会丢失两端数据

位置：[sync.ts:803](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/sync.ts:803)，[sync.ts:442](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/sync.ts:442)。

`cleanupDeletedRuns()` 删除所有不在本地集合中的远端任务，而 Pull 在远端集合非空时删除所有不在该集合中的本地任务。这里没有区分“另一设备新建、尚未同步”和“用户明确删除”。因此设备 A 尚未获取设备 B 的新任务时，A 的自动 Push 会删除 B 的任务；本机新建但未上传的任务也会被 Pull 删除。检测到本地冲突后只是追加提示，仍继续执行删除，最后还把 dirty 清空。

复现：用完全模拟的远端调用实际 Push/Pull 方法。Push 删除 `users/fixture/runs/remote-existing.json`；随后带冲突的 Pull 删除 `local-new`，返回 `dirty=false`。

建议：使用显式删除记录（tombstone）及对象修订号，仅传播真实删除；冲突时保留双方数据，不继续执行破坏性同步，也不清除未成功上传的本地修改标记。验收需覆盖两台设备离线新增、删除、交错同步以及冲突后的重试。

## 2. [P1] 强制重置执行中的节点会留下 worker，并使主服务异常退出

位置：[run-manager.ts:493](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/run-manager.ts:493)，[agent.ts:807](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/agent.ts:807)，[agent.ts:823](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/agent.ts:823)。

`forceResetNode()` 只把节点改为 ready，没有取消或等待活动 Turn。旧 worker 结束时，`finishExecution()` 向已经不是 running 的节点提交决策而抛错；catch 中的 `failTurn()` 再次向同一节点提交失败，又抛出未处理的 Promise rejection。最新 Turn ID 未变化，因此现有 ID 检查挡不住这条路径。回滚活动节点也有相同的生命周期协调缺口。

复现：脚本输出 STARTED，延迟写文件；收到 STARTED 后强制重置。重置后 worker 仍活跃、延迟文件确实写入，随后出现 `Node ... is not running`。另外在不安装异常监听器的独立 Node 进程中验证，进程退出码为 **1**，栈指向 `agent.ts:824 → agent.ts:810`。

建议：重置/回滚先取消并等待执行结束，再改变状态；给每次节点执行增加有效代次，旧回调不得影响新状态；失败清理应幂等，所有后台 Promise 最终都应有不会再次抛出的错误处理。仅吞掉异常不能解决旧进程继续写入的问题。

## 3. [P1] 上游回滚重做后，下游重跑仍使用旧上游代码

位置：[agent.ts:84](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/agent.ts:84)，[execution-workspace.ts:120](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/execution-workspace.ts:120)。

回滚重置节点状态但保留历史 Turns；`workspaceJob()` 无条件选取本节点前一次 Turn。只要 `previousTurnId` 存在，`prepare()` 就从旧尝试创建工作区，完全跳过当前 `predecessorTurnIds`。这混淆了“相同输入的局部重试”和“上游变更后的重新执行”。

复现：真实 Git/worker 执行 A(v1) → B；回滚 A，再执行 A(v2) → B。A 的文件为 v2，B 读取到的仍是 **v1**，整个 Run 却能进入 completed。该复现使用简化审批以隔离代码继承问题；真实验证也不会自动检查当前上游 commit 是否已包含在 B 中。

建议：把上游 Turn/commit 集合作为尝试输入的一部分；输入变化时重新组装工作区，必要时显式合并本节点旧修改并处理冲突。不得通过 previousTurnId 省略新的上游依赖验证。

## 4. [P1] 跳过中间节点会丢失已批准祖先的代码

位置：[agent.ts:87](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/agent.ts:87)。

DAG 允许 skipped 前驱满足执行依赖，但工作区仅收集直接且 completed 的前驱。在线性 A → B → C 中，A 完成后跳过 B，C 会从 Run 初始基线开始，A 的已批准代码不再进入 C。最终从 C 交付时也会遗漏 A 的改动。

复现：A 创建 `upstream.txt`，B 被跳过，C 的输出为 `MISSING`，C 工作区确实没有该文件。

建议：让 skipped 节点传递有效输入快照，或沿有效依赖边解析最近的已批准代码祖先；同时保留条件分支语义，不能把未激活分支的代码一并合入。

## 5. [P1] 回滚清空的产出物在重启后重新出现

位置：[storage-sqlite.ts:268](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/storage-sqlite.ts:268)，[run-manager.ts:525](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/run-manager.ts:525)。

回滚在内存中设置 `node.artifacts = []`，但 SQLite 保存只 upsert 当前数组中的产出物，从不删除已不在数组中的旧记录。`saveAll()` 也没有做这项删除。重启重新组装节点时，已废弃产出物会回到当前节点，继续被上下文和契约校验读取。

复现：临时 SQLite 中保存 `old-artifact` 后回滚，内存产出物数为 0；新建 WorkflowEngine 并加载同一测试数据库后，`old-artifact` 再次出现。

建议：在同一事务中同步删除不再属于当前节点的产出物；如需保留历史，按 Turn 归档并与当前产出物分开，不能让历史记录重新满足当前契约。

## 6. [P1] 自动 Skill 沉淀修改原仓库，阻断刚批准代码的合入

位置：[index.ts:336](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/index.ts:336)，[skill-extraction.ts:303](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/skill-extraction.ts:303)，[artifact-merge.ts:225](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/artifact-merge.ts:225)。

节点完成事件会自动把符合条件的产出物写到原项目 `.agent-flow/skills/`，而新的本地交付要求原项目完全干净。对于没有忽略该目录的正常仓库，用户批准节点后，系统自己的写入就会使后续合入失败。手动提交这些文件又会推进基线，触发另一个“目标分支已变化”阻断。

复现：使用默认沉淀阈值生成一项 Skill（置信度 0.97）；原项目状态变为 `?? .agent-flow/`；随后真实 `mergeBranch()` 返回 `Merge failed: Project has uncommitted changes`。复现单独放开批准检查，以只验证沉淀与交付的冲突。

建议：将自动沉淀先存入应用数据目录，或作为受审查工作区内的产出随代码一起交付；不能在批准和交付之间隐式修改目标仓库。

## 7. [P2] “打回重做”进入 running，但没有启动新 Turn，还会绕过并行限制

位置：[run-manager.ts:464](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/run-manager.ts:464)，[RunDetail.tsx:1014](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/client/src/components/detail/RunDetail.tsx:1014)。

Reject API 只修改节点为 running，前端也只调用 Reject。ReadyDispatcher 只领取 ready，前端启动按钮同样只在 ready 显示。因此正常点击“打回重做”后，节点显示执行中但没有新执行，只能再通过取消/重置绕回来。这个状态还计入 maxParallel，却未经过容量检查。

复现：maxParallel=1，一个节点待审核、另一个 running；打回审核节点后 running 数变为 2。实际 dispatcher 没有派发新执行，旧 Turn 已结束。

建议：打回保存反馈后进入 ready，由统一领取路径负责重跑及容量检查；手动模式展示可再次执行的状态。

## 8. [P2] 验证脚本仍可留下后台进程，并在代码继续变化前报告通过

位置：[validation-turn.ts:464](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/validation-turn.ts:464)。

主执行已经使用 worker/进程组，但验证仍直接 `exec()`。它只检查 shell 的退出，没有确认普通后台子进程已结束。后台进程关闭或重定向 stdio 后，验证会先成功返回，前后代码指纹也可能相同；子进程随后仍可修改文件。事后查询指纹会使证据失效，但在写入前存在已通过且可交付的窗口。

复现命令：`(sleep 1; echo late > validation-late.txt) >/dev/null 2>&1 &`。真实隔离工作区验证返回 `passed=true`，立即读取缓存也是 true，随后出现延迟写入的文件。

建议：验证复用执行生命周期管理，等待或拒绝遗留子进程，取消和超时也必须覆盖验证进程组；所有进程停止后再生成证据。

## 9. [P2] 验证缓存失效后，界面没有重新验证入口

位置：[validation.ts:39](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/routes/validation.ts:39)，[ValidationTurnPanel.tsx:187](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/client/src/components/detail/ValidationTurnPanel.tsx:187)。

验证结果仅驻留内存，服务重启后完成门禁会要求重新验证。但汇总 API 只返回已经有有效结果的节点，前端也只为返回的行提供触发按钮；空列表仅显示“暂无验证结果”。重启、证据过期或验证异常导致节点没有结果时，用户无法通过该界面恢复审批/交付，只能直接调用 API 或重跑任务。

复现：新 ValidationTurnService 加载已有 Run，实际汇总路由返回 `existingNodes=1`、`results=[]`；前端空列表分支没有触发操作。这里验证了 API 和组件代码路径，没有声称跑过浏览器交互测试。

建议：返回所有节点，没有有效证据时使用 `result:null`；保留重新验证按钮，展示失败或过期原因，触发成功后刷新完整列表。

## 10. [P2] scriptCwd 在上游代码组装之前校验，阻断新目录中的后续任务

位置：[index.ts:287](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/index.ts:287)，[execution-workspace.ts:140](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/execution-workspace.ts:140)。

自动 DET/HYB 先在未改动的原项目中 realpath `scriptCwd`。如果目录由前驱在隔离工作区创建，这一步会直接 ENOENT，worker 根本无法开始准备。另一个同类问题出现在多前驱：工作区仅检出第一个前驱时就解析 cwd，之后才合并其他前驱；目录由第二个前驱创建也会失败，并留下没有 manifest 的 worktree。

复现：前驱创建 `generated/` 后，自动入口使用的原项目目录解析函数报 ENOENT。另用真实多前驱 Git 工作区验证，第二个前驱引入 `generated/`，子节点 `prepare()` 报 ENOENT 且 `ledgerCreated=false`。

建议：入口只检查配置格式和路径边界；组装全部代码输入后，再在最终工作区解析目录及符号链接边界。准备失败也应有可追踪的工作区记录或清理路径。

## 11. [P2] 带反馈批准会立即使刚通过的验证失效

位置：[run-manager.ts:433](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/run-manager.ts:433)，[validation-turn.ts:281](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/validation-turn.ts:281)。

`approveNode()` 先检查验证，然后把反馈追加为 artifact。验证配置签名包含整个 `node.artifacts` 数组，因此“修改后继续”批准成功的同时证据已经失效。节点已经 completed，下游可以启动，但本节点的 Diff 交付会被拒绝；结合上一项空结果 UI，用户还不容易重新验证。

复现：验证通过后调用带反馈的 approve，节点为 completed，`getValidationResult()` 已返回 undefined。

建议：将批准意见与实际被验证产出分开保存；若反馈确实改变需验证的输入，就必须在标记 completed 和启动下游前重新验证。

## 12. [P2] 跨设备同步的版本比较遗漏执行中的节点进展

位置：[sync.ts:601](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/server/src/services/sync.ts:601)。

Run 的 `startedAt/createdAt` 在节点推进、打回、暂停时不更新；`mergeRun()` 却只比较这些时间和最终 `completedAt`，且要求远端严格更大。两个设备已有同一运行中 Run 后，远端的节点进展和暂停状态会被长期忽略，通常直到整个 Run 完成才有机会更新。Pull 仍将这次同步记作成功。

复现：本地与远端 startedAt 均为 10；远端 paused 且节点已更新，调用实际 `mergeRun()` 后本地仍 running，节点内容未更新。

建议：持久化明确的对象 revision/updatedAt，并在每次业务变更时推进；与删除记录、冲突处理统一设计，不要以生命周期时间戳充当同步版本。

## 13. [P2] 迟到的 REST 响应可覆盖 WebSocket 新状态，游标仍停在新版本

位置：[RunsPanel.tsx:43](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/client/src/components/detail/RunsPanel.tsx:43)，[RunDetailPage.tsx:27](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/client/src/pages/RunDetailPage.tsx:27)，[appStore.ts:111](/Users/pengshujian/Desktop/AISpecCoding/agent-flow/packages/client/src/store/appStore.ts:111)。

页面用 REST 获取任务后无条件 `setRuns()`，而新 WebSocket 同步另有 epoch/sequence。若旧 REST 请求先发出、在新的 snapshot/事件之后才返回，会把 completed 覆盖回 ready，甚至覆盖其他项目的全局 Run 集合。ReplayCursor 已记录新序号，重复事件不会再次应用，因此重放机制无法自行修复被 REST 覆盖的状态。

复现：直接使用真实 Zustand store 和 ReplayCursor，先应用 sequence=10 的 completed 快照，再写入迟到的 ready 列表，随后重放同序号事件，最终状态仍为 **ready**。验证的是确定的状态更新顺序，未模拟浏览器网络调度。

建议：统一状态初始化入口；或给 REST 快照附带同一版本信息，忽略过期响应并按项目合并。业务状态写入必须与游标推进保持一致。

## 验证与覆盖边界

- 当前后端完整测试：**21 个文件，205/205 通过**。
- `yarn build`：前后端通过；`yarn lint`：0 errors、7 个原有 React Hooks warnings；`git diff --check` 通过。
- 额外复现使用真实临时 Git 仓库、内存/临时 SQLite、真实本地 worker、真实前端 store/cursor；同步使用模拟远端，没有发送真实 GitHub 请求。
- 没有调用真实 Codex/Claude 模型，没有启动应用迁移个人数据库，没有执行真实远端 Push/PR，也没有完成浏览器端到端测试或 Windows 进程验证。因此这些外部链路仍需后续集成验收。
- 复现工具保留在本机临时目录：[主复现脚本](/tmp/agent-flow-cr-repro.mjs)、[补充复现脚本](/tmp/agent-flow-cr-additional.mjs)、[进程退出复现](/tmp/agent-flow-cr-crash.mjs)。前两个可在本仓库执行 `node --import tsx /tmp/agent-flow-cr-repro.mjs` 和 `node --import tsx /tmp/agent-flow-cr-additional.mjs`；脚本内固定当前仓库路径，使用临时数据，不能作为可移植 CI 测试直接复制。第三个需要一个临时目录参数，预期异常退出。
- 原始结果：[主结果](/tmp/agent-flow-cr-results.json)、[补充结果](/tmp/agent-flow-cr-additional-results.json)、[测试日志](/tmp/agent-flow-cr-tests.log)。临时文件可能被系统清理，关键结果已写入本文。

建议修复顺序：先处理同步删除和执行生命周期，再修复回滚/跳过的代码继承及 SQLite 产出物删除，接着解决沉淀与交付冲突，最后统一验证恢复入口和前端状态版本。将本文复现场景转成跨服务回归测试，比继续增加彼此隔离的单元测试更能保护这批升级。
