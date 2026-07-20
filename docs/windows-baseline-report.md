# Windows 基线稳定化报告

日期：2026-07-20  
验证系统：Windows 11  
基线运行时：Node.js 22.23.1、Corepack、pnpm 10.29.3

## 运行与构建基线

- 开发和生产服务统一绑定 `127.0.0.1:3100`。
- Windows 默认使用 Next.js Turbopack 构建；Linux/macOS 保留原 Webpack 路径，可用 `MC_BUILD_BUNDLER` 显式覆盖。
- Node.js 22.23.1：`pnpm build` 成功，约 84.5 秒。
- Node.js 24.14.0：`pnpm build` 成功，约 47.6 秒。
- Windows Webpack 构建可重复停在 `Creating an optimized production build`：高资源阶段后转为空闲等待，未发现网络连接、字体下载、数据库锁或遗留子进程。该现象与 Node 22/24 无明显差异。
- Turbopack 构建仍会输出非致命 NFT tracing 警告，但产物可启动，登录页返回 HTTP 200。

## 初始 43 个单元测试失败分类

| 类别 | 数量 | 失败组 | 处理结论 |
| --- | ---: | --- | --- |
| A. Windows 路径差异 | 15 | config 3、paths 5、OpenCode sessions 2、OpenCode transcript 3、security properties 2 | 使用 `path` API、平台路径断言和 Windows 路径归一化修复 |
| B. CRLF/LF 差异 | 15 | navigation 1、workflow permissions 11、workspace SQL 2、workspace isolation 1 | 比较源码前统一换行；安全断言内容未放宽 |
| C. 符号链接/权限语义 | 3 | security-scan fix 1、skills route security 2 | Windows 使用目录 junction；POSIX mode 位仅在 POSIX 精确断言，Windows 仍验证不可执行及安全行为 |
| D. 测试环境缺少 Git 身份 | 8 | GNAP sync 8 | 只为测试子进程设置隔离的 author/committer 环境变量，未修改全局 Git 配置 |
| E. 临时目录硬编码 | 0 | `/tmp` 问题由代码审查发现，不在这 43 项中 | 生产代码改为 `os.tmpdir()` 与 `path.join()`，任务结束后清理 |
| F. SQLite/OpenCode 真实兼容问题 | 0 | 初看为 OpenCode 失败，实际是 mock 使用 `/` 分割 Windows 路径 | 未跳过；生产路径解析已修复 |
| G. Workspace 隔离/安全契约真实失败 | 0 | 初看为隔离断言失败，实际是换行/路径差异 | 所有隔离和安全测试继续执行并通过，无跳过 |
| H. 超时/稳定性 | 2 | gateway auth scan 1、auth password scan 1 | 保留真实扫描，预热一次并给相关测试显式 15 秒超时 |
| I. 其他真实功能问题 | 0 | 无 | 无测试被删除或粗暴跳过 |

另有一个 `task-dispatch-sandbox` 文件级加载失败，属于 Windows 符号链接语义差异，不计入 Vitest 报告的 43 个失败测试；已用 junction 兼容。一次诊断运行设置了 `MC_DISABLE_RUNTIME_SCAN=1`，人为增加了 1 个 OpenCode runtime 失败，因此该次 44 项结果未作为基线结论。

最终单元测试结果：175 个测试文件、1510 个测试全部通过。

## E2E 失败调查

初次 Windows E2E 为 483 通过、30 失败：

- 27 项 CLI/MCP 失败：子进程测试仍访问旧端口 `127.0.0.1:3005`，而 WebServer 已迁移到 3100。
- 1 项 OpenCode continuation：E2E mock 是 Bash 文件，Windows 无法直接执行。
- 2 项任务状态：开发者 `.env` 的 `MC_COORDINATOR_AGENT` 泄漏到测试数据库，破坏测试隔离。

修复后：

- 标准 Playwright：513/513 通过。
- OpenClaw local harness：4/4 通过。
- OpenClaw gateway harness：4/4 通过。
- Playwright WebServer 仅监听 `127.0.0.1:3100`，登录页可打开。
- Windows 原退出码 `3221226505`（`0xC0000409`）由 `fs.cpSync(..., { recursive: true })` 在当前 Unicode 工作区路径下触发的原生崩溃导致；改为逐目录 `copyFileSync` 后消失。

## 安全结论

- 未删除或跳过安全隔离测试。
- 未关闭 `minimumReleaseAge`，lockfile 保留安全解析结果。
- 未把 `.data`、`.env`、数据库、日志或本地凭证加入 Git。
- Codex 配置仅在备份后删除 CLI 0.116.0 不接受的 `service_tier = "default"`；未读取 `auth.json`。
