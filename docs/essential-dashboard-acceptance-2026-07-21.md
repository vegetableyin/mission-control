# Essential Dashboard 验收记录（2026-07-21）

## 验收范围

- 分支：`feature/hankqing-essential-dashboard`
- 基线：`baseline/windows-20260720`
- 运行时：Node.js `22.23.1`、Corepack、pnpm `10.29.3`
- 本地地址：`http://127.0.0.1:3100`
- 本轮仅完成中文化、Essential / Full 导航、个人驾驶舱、Codex 状态、待处理中心及生产运行收口；未实现项目目录扫描、ChatGPT 台账、自动汇报或新任务执行器。

## 生产构建与运行

- `pnpm build`：退出码 `0`，墙钟耗时 `82.6s`（应用记录 `81.6s`）。
- 构建警告：`69` 条，均为 Turbopack/NFT 对 `next.config.js` 动态依赖追踪的同类警告。
- 已确认产物：`.next/BUILD_ID`、`.next/standalone/server.js`、`.next/routes-manifest.json`。
- 独立产物检查通过；`.next/static` 与 `public` 已复制到 `.next/standalone`。
- 生产命令 `fnm exec --using=22.23.1 corepack.cmd pnpm start` 可启动，且只监听 `127.0.0.1:3100`。
- `/login` 返回 HTTP 200，登录后 Essential / Full 模式、语言切换和重启持久化均通过。
- 有效验收流程中未捕获前端异常，未观察到 API 500。

## 浏览器验收矩阵

- 默认简体中文：通过。
- 默认 Essential：通过。
- Essential 导航严格为：总览、项目、任务、Codex、定时任务、待处理、活动记录、设置。
- Full 模式恢复完整导航：通过。
- Essential 下直接访问隐藏路由：显示切换 Full 模式提示，不返回 404。
- 中文与英文双向切换：通过。
- 服务重启后语言和界面模式保持：通过；验收结束后恢复为中文 + Essential。
- 首页异常排序：阻塞 > 失败 > 等待确认 > 告警，通过。
- 首页空状态：通过。
- 首页六个指标卡跳转：通过。
- 桌面深色、桌面浅色、手机端、Codex、待处理、Full 导航和设置页截图已完成。

## 首页现有数据来源

- `/api/projects?includeArchived=1`
- `/api/tasks?limit=200`
- `/api/sessions`
- `/api/activities?limit=12`
- `/api/cron?action=list`
- `/api/alerts`

Codex 页面复用 `/api/agent-runtimes` 与 `/api/sessions`；待处理中心复用任务、告警、定时任务和 `/api/exec-approvals`。本阶段没有新增业务表、任务执行器、ChatGPT 网页或 Cookie 读取，也没有扫描 `D:\Work`。

## 中文化检查

- `messages/en.json` 与 `messages/zh.json`：`2211` 个键完全一致。
- Essential 主流程未显示原始翻译键。
- 仍存在的明显硬编码英文主要位于 Full 模式旧面板和 Settings 的动态配置元数据，包括：`Activity`、`Fleet Status`、`Task Pipeline`、`Running`、`Idle`、`Sessions`、`Task Board`、`View Logs`、`Memory`、`Customize`、`General`、`Security`、`Security Profiles`、`Data Retention`、`Chat`、`Gateway`、`Site Name`、`Auto Cleanup`、`Auto Backup`、`Backup Retention Count`、`Plan Override`、`Agent Runtimes`、`Installed`、`Stopped`、`Refresh`、`Configure`。
- Codex、GitHub、API、Token、MCP 等技术名词按约定保留英文。

## 最终检查

- `pnpm lint`：通过，`65.4s`。
- `pnpm typecheck`：通过，`65.8s`。
- `pnpm test`：177 个测试文件、1520 项测试全部通过，`72.7s`。
- `pnpm build`：通过，退出码 0，`82.6s`。
- 标准 Playwright：514 项中 513 通过、1 失败，`254.2s`。唯一失败是 `awesome-openclaw` 技能注册表测试访问 GitHub Raw 时超过 60 秒；属于外部网络依赖超时，不是本阶段页面、数据库或安全隔离回归。测试未删除或跳过。

## 已知警告与后续边界

- 标准 E2E 的开发服务器会输出 `NO_COLOR` / `FORCE_COLOR` 警告，以及 Next.js 开发态 CSP nonce hydration 警告；生产模式 nonce 与 CSP 已一致，生产验收未复现前端错误。
- 全新数据库的首次请求可能因迁移和运行时初始化超过 30 秒，后续 `/login` 约 0.2 秒。
- Full 模式与 Settings 的旧模块仍需继续收敛硬编码英文。
- 建议进入第三阶段前先完成上述遗留中文字符串和外部注册表 E2E 去网络化；当前核心功能已具备继续开发条件。
