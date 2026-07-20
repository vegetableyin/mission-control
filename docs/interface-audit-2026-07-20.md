# Mission Control 界面基线审计（2026-07-20）

审计环境：Windows 11、Node.js 22.23.1、本地模式、`http://127.0.0.1:3100`。审计以实际浏览器页面、当前路由代码和 API 行为为准。截图保存在本机忽略目录 `docs/ui-audit/`，不会推送到公开 Fork。

## 页面与导航结论

| 页面 | 当前路由 | 实际用途 | 个人使用价值 | 建议 | 基线中文情况 |
|---|---|---|---|---|---|
| Dashboard | `/overview` | 通用系统健康、会话、任务管线和小组件总览 | 高，但原版不聚焦人工决策 | Essential 重做；Full 保留原版 | 导航已译，卡片大量英文 |
| Projects | 原先无独立路由；通过项目切换器和任务页弹窗管理 | 建立项目、切换项目、关联任务 | 高 | 新增 `/projects` 聚合入口，不改数据模型 | 项目弹窗部分中文 |
| Tasks | `/tasks` | 看板、派发、审查、质量审核、失败和完成状态 | 高 | Essential 保留 | 主流程已译；基线缺少 4 个中文键，包含 `taskBoard.taskBoard` 原键外露 |
| Agents | `/agents` | 查看本地 `AGENTS.md`、Agent Squad、命令和编排状态 | 中 | Full 保留；能力由 Codex 入口摘要 | “智能体”外层已译，内部大量英文 |
| Sessions / Chat | `/sessions`、`/chat`（同一 ChatPagePanel） | 汇总 Claude、Codex、OpenCode、Hermes 会话和对话 | 高（Codex 子集） | Full 保留原页；Essential 提供 Codex 专页 | 会话列表大量英文 |
| Activity | `/activity`（`/history` 同组件） | 任务、Agent、评论等活动流 | 高 | Essential 显示为“活动记录” | 主体已有中文，局部英文 |
| Schedules / Cron | `/cron` | 读取 OpenClaw 定时任务、日历、历史和运行状态 | 高 | Essential 显示为“定时任务” | 主流程已中文，任务内容与部分术语保留英文 |
| Alerts | `/alerts` | 配置告警规则，不是独立通知引擎 | 中 | Full 保留；触发结果汇总到待处理 | 部分中文，规则编辑仍有英文 |
| Approvals | `/exec-approvals` | 网关执行审批 | 条件性高 | Full 保留；有数据时汇总到待处理 | 本地模式只显示“需要网关连接” |
| Settings | `/settings` | 通用、安全、运行时、API Key、语言、界面模式 | 高 | Essential 保留 | 外层中文；运行时和旧界面模式选择器大量英文 |
| GitHub | `/github` | GitHub 仓库/Issue/PR 同步 | 中 | Full 高级模式 | 混合中英文 |
| Memory | `/memory` | 浏览和检索 Agent 记忆 | 低至中 | Full 高级模式 | 混合中英文 |
| Skills | `/skills` | 管理 Agent Skills | 低至中 | Full 高级模式 | 混合中英文 |
| Office | `/office` | Agent 办公室可视化与会话编排 | 低 | Full 高级模式 | 大量英文 |
| Flight Deck | 无独立路由；Office 内的 companion 启动动作 | 外部 companion 控制入口 | 低 | Full 保留原动作 | 英文为主 |
| Monitor | `/monitor` | 系统资源、进程与运行状态 | 中 | Full 高级模式 | “Monitor”及内部大量英文 |
| Aegis / Evals | 无独立导航；Aegis 位于任务质量审查，Evals 位于 `/security` | 安全、质量和评估 | 条件性高 | Full 保留；不改安全逻辑 | 混合中英文 |
| OpenClaw 页面 | `/gateways`、`/gateway-config`、`/channels`、`/nodes`、设置与顶部横幅 | 网关、配置、频道、节点、更新和诊断 | 本地个人模式较低 | Full 保留；本地不可用页面仍给出说明 | 外层多已译，诊断与配置大量英文 |

## 基线导航与路由关系

- 基线 Essential 实际显示：概览、智能体、任务、聊天、活动、日志、设置，与本阶段目标不一致。
- Full 模式由 `nav-rail.tsx` 的分组定义提供全部原面板；`[[...panel]]/page.tsx` 的 `ContentRouter` 负责路由到组件。
- `/sessions` 与 `/chat` 当前都指向 `ChatPagePanel`。
- 项目管理原先是上下文切换器与 `ProjectManagerModal`，没有独立 Projects 页面。
- Flight Deck、Aegis、Evals 不是独立一级页面，不能按名称简单删除或隐藏。
- 本地模式下网关专属页面不会 404，而是显示需要网关连接的说明。

## 本阶段信息架构

- Essential：总览、项目、任务、Codex、定时任务、待处理、活动记录、设置。
- Full：保留全部原导航和原路由，并同时保留新增的项目、Codex、待处理聚合入口。
- Essential 隐藏的路由仍可直接访问；页面会提示切换 Full，不会返回 404。
- 首页只使用项目、任务、会话、活动、定时任务和告警规则等现有数据；无数据时显示明确空状态。

