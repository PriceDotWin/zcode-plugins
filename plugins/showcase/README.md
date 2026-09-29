# showcase 0.4.2

输入 **“用 Showcase 演示全部 case”**，模型调用 `show_cases` 打开可搜索的 SC01–SC53 目录。每项有操作、预期、入口和中英说明；“直接操作 / 配合操作 / 自动化专用 / 待宿主实现”明确区分。53 是目录项数，不是自动验收通过数。

## 使用与验证

开发需先构建，再在插件商店添加 `dist/local-marketplace` 的绝对路径，安装并启用 Showcase。不要添加仓库根目录，其官方来源名称属于保留名称。源码更新后重新构建、刷新来源、重新安装插件，并在新会话测试。清单始终启动安装目录中的 `dist/server.mjs`。

```bash
pnpm build
pnpm --filter @zcode/plugin-showcase test
pnpm --filter @zcode/plugin-showcase typecheck
pnpm test:artifacts
```

构建把官方 SDK、case 数据与样式内嵌进 HTML，server 打成单文件；安装后无 npm/CDN 依赖。测试启动实际构建产物。Electron 入口使用隔离 profile、当前源码 Agent、本地模型 fixture，不访问真实账户。

## 演示路线

1. **完整目录**：`show_cases`，可传 `caseId: "SC36"`。选择条目后前往操作区，或编辑演示指令；只有点击发送才进入主对话。
2. **基础 SC01–SC31**：`show_dashboard` 可传 `demoTab: "data/actions/state/resources/files/host/log"` 中的一个值。保留服务表、资源/订阅、上下文、文件、别名与日志。`open_editor` 打开侧栏，`show_status_banner` 展示资源级元数据，`inspect_service` 路由服务监控面板。
3. **保活/存储 SC32–SC33**：填写、计数、滚动，切换内联/侧栏/任务后比较启动标识和页面值。另写 LS/IDB 样本，重建/重启后读回；删除按钮只删本实验室样本。
4. **取消 SC34**：运行十秒只读 `cancellable_check`，遵循宿主审批；取消后可运行新的检查。App 工具进度未实现，不画模拟进度。
5. **失败 SC35**：先保留成功仪表盘，用失败区准备 `show_failure` / `show_failure_fullscreen` / `show_failure_pinned` 指令，可选抛异常。经模型工具行观察不新建/不替代成功页面。
6. **Sampling SC36–SC41/SC49**：文本、多轮、固定 PNG、取消、清空和参数拒绝。使用当前任务模型及用量；仅发送 App 已完成历史，回答留在 App。能力不可用时禁用发送。
7. **生命周期/隔离 SC42–SC50**：按目录进行在途迁移、双窗口/工作区隔离、回收重试、隔离 profile 清数据、平台回退和模型切换。内部容量/代际/迟到响应提供真实 fixture 命令，不向插件暴露内部接口。
8. **页面工具 SC53**：保持实验室打开，请模型调用页面提供的 `page_edit`。`key` 为便签文字，`delayed: true` 等待页面“完成”按钮。停止主回合应取消且不改变便签；遵循宿主审批、认领和来源隔离。

## 当前边界

- SC51（纯图片/资源链接内容扩展）、SC52（App 工具双向进度）待宿主实现；SC20 模型工具行进度仍可演示。
- `widgetState` 是重启即丢的宿主内存快照；LS/IDB 是稳定来源下的浏览器存储；普通输入和计数是活 guest 的 JS/DOM。不能互相冒充。
- Web、手机、远程 workspace 回退普通工具记录；本地 Desktop 运行 MCP App。Gen UI/visualize 使用独立协议。
- 仅明确要求时使用 `simulate_crash`；会退出模拟 server 并清空其内存数据。
- 允许域可能因离线失败；下载、外链、原生权限需观察真实宿主结果。全局清数据只在隔离 profile 使用应用设置操作。
- 导出的观察记录属于当前页，不是全套验收通过报告。

## 文件与所有权

以下源码路径相对 `ui-plugins/showcase/`。

| 文件                                                     | 用途                                                 |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `cases.json`                                             | 53 项目录唯一来源：双语步骤/预期、执行方式、工具参数 |
| `server.mjs` / `demo-tools.mjs`                          | 模拟服务、case 入口、取消和错误工具                  |
| `resources.mjs` / `data.mjs`                             | 异步资源、订阅登记、进程内模拟数据                   |
| `ui/index.html` / `ui/banner.html`                       | 原有 alias 接口与基础演示                            |
| `ui/cases.html` / `ui/cases-client.mjs` / `ui/lab-*.mjs` | 一个官方 App 连接、目录、sampling、存储、页面工具    |
| `src/contract.ts` / `src/*.test.ts`                      | 公共合同与构建产物的真实 stdio 验证                  |

新增工具/资源同步合同。页面通过 SDK/公开 alias 访问宿主，不导入内部实现。用内容容器测高度，不使用 `documentElement.scrollHeight` 与视口形成反馈回环。

## 独立仓库构建

在 zcode-plugins 根目录执行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm typecheck`、`pnpm test` 和 `pnpm test:artifacts`。源码位于 `ui-plugins/showcase`，可安装产物位于 `plugins/showcase`；不要直接安装源码目录。`python3 scripts/build_dist.py` 生成 marketplace zip。运行需要 Node.js 24；不需要主应用源码或私有插件 SDK。
