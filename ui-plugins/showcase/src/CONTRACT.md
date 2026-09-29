# 演示插件工具表、资源与数据形状

演示插件 0.4.2：SC01–SC53 目录以 `cases.json` 为唯一来源，产品规则`server.mjs` / `demo-tools.mjs` 提供工具，`resources.mjs` 异步读取自足页面并拥有订阅登记，`data.mjs` 拥有进程内模拟服务数据。

合同是工具表（`TOOLS`：名字、可见性、resourceUri、fullscreen、surface、timeoutMs、动态注册）、资源表（`RESOURCES` 与模板）、banner `_meta`、面板 id、仪表盘/实验室 widgetSessionId，以及五种 structuredContent（`DashboardSnapshot` / `BannerSnapshot` / `ServiceDetail` / `AuditLog` / `CasesSnapshot`）。测试启动 `dist/server.mjs`，真实校验合同、通知、进度、动态注册与 elicitation，不 mock server。

基础页面使用 `window.zcode`；实验室只使用一个官方 App 连接。sampling 历史、页面便签、输入与计数属于活 guest；宿主拥有凭证、调用终态、活页和 widgetState，LS/IDB 由稳定浏览器来源隔离。`page_edit` 通过官方 App 提供，不在 server 的 `TOOLS` 重复登记。

`show_cases` 使用独立资源和 widgetSessionId。`cancellable_check` 是 app-only 只读可取消工具；三个 `show_failure*` 保留展示元数据并产生真实错误。工具/资源在 `src/contract.ts` 同步。演示脚本见 README；宿主规则内部注入和跨平台验证不能用页面按钮成功替代。

插件身份：目录和清单使用 `showcase`，对应 MCP 页面资源使用 `ui://showcase/` 命名空间；客户端、服务端与集成测试保持一致。
