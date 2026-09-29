# Disk Cleaner for ZCode

本插件通过本地 marketplace 安装；下方流程用于源码目录或独立插件包。

Agent 或用户发起只读扫描，侧栏面板展示目录与类型占用、大文件排行；用户逐项勾选、检查清理计划后，文件被移入系统回收站（macOS 废纸篓 / Windows 回收站 / Linux `gio trash`），可以随时还原。插件不提供永久删除，模型也没有清理工具。

## 构建与加载

需要 Node.js 24+ 和支持 Plugin UI 的 ZCode Desktop。本仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
```

源码位于 `ui-plugins/disk-cleaner`。构建后在插件商店添加 `dist/local-marketplace` 的绝对路径作为本地 marketplace，安装并启用 `disk-cleaner`；安装内容位于 `plugins/disk-cleaner`。不要添加仓库根目录，其官方来源名称属于保留名称。源码更新后重新构建、刷新来源、重新安装插件，并在新会话测试。MCP 与面板均已打入 `dist/`，运行时无需安装 npm 依赖，也不依赖主应用源码或私有 SDK。

启用后可发送：“看看我的下载目录里哪些大文件占空间”。模型调用 `scan_directory` 后侧栏打开面板；也可以直接在面板里输入路径、选择阈值，或点击“主目录 / 下载 / 桌面”快捷项。

## 使用规则

- 扫描只读元数据，不跟随符号链接、junction，不进入系统目录、应用数据、凭据目录、`.git`、回收站与 macOS 应用包。无权限目录计入“部分结果”并提示授权方式。
- 排行保留最大的若干文件，按名称搜索、按类型筛选；每次清理最多 100 个文件。硬链接文件只展示，不可清理。
- “检查并清理”会生成 5 分钟有效的计划；执行前逐项重新核对文件身份（设备号、inode/文件 ID、大小、修改与变更时间、链接数）和父目录真实路径，任何变化都跳过该文件。
- 同一计划重复确认不会重复移动。新扫描会使旧计划与结果失效。

## 平台说明

| 平台    | 回收站实现                                           | 限制                                           |
| ------- | ---------------------------------------------------- | ---------------------------------------------- |
| macOS   | JXA 调用 `NSFileManager trashItemAtURL`              | 受 TCC 保护的目录需授予完全磁盘访问权限        |
| Windows | PowerShell `Microsoft.VisualBasic.FileIO` 移入回收站 | 只清理固定磁盘上的文件；网络盘、可移动盘仅分析 |
| Linux   | `gio trash --`                                       | 未安装 `gio` 时只分析，不能清理                |

文件路径通过环境变量传给子进程，不拼接进命令行。

## 验证

```sh
pnpm --filter @zcode/plugin-disk-cleaner test
pnpm --filter @zcode/plugin-disk-cleaner typecheck
pnpm --filter @zcode/plugin-disk-cleaner smoke
pnpm --filter @zcode/plugin-disk-cleaner test:e2e
```

smoke 与 e2e 在临时目录中造文件，并通过 `ZCODE_DISK_CLEANER_TEST_TRASH` 把回收站替换为隔离目录，不会触碰真实回收站。e2e 需要本机 Chrome，或以 `CHROME_PATH` 指定浏览器。

浏览器 E2E 使用真实官方 App/AppBridge 与构建后的 stdio 服务；不替代桌面沙箱、真实系统回收站或其他平台安装验证。
