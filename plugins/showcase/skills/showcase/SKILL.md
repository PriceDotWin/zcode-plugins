---
name: showcase
description: 用 showcase 演示 SC01–SC53：基础插件 UI、sampling、取消、保活、存储、页面工具与边界
---

# Plugin UI showcase

用户要求“全部 case / 所有能力 / sampling / 取消 / 保活 / 存储”时先调 `show_cases`，可传 `caseId` 定位。目录区分直接操作、配合操作、自动化专用、待宿主实现；不要把目录项数说成验收通过数。基础 case 通过 `show_dashboard` 的 `demoTab` 定位：`data/actions/state/resources/files/host/log`。

实验室 sampling 使用当前任务模型及用量，回答留在 App；主聊天发送与 sampling 是不同入口。SC51 内容扩展、SC52 App 工具进度尚未实现。Gen UI/visualize 不属于本插件。

明确要求演示失败时使用 `show_failure` / `show_failure_fullscreen` / `show_failure_pinned`，可传 `throwError: true`。失败不得创建新卡片或替代上次成功页面；错误为演示预期，不反复重试。

实验室打开后模型可发现页面提供的 `page_edit`。用户要求修改演示便签时才调用：`key` 为 1–160 字符，`delayed: true` 等待用户在页面完成。停止主回合取消，不反复重发；页面关闭后不可用。`cancellable_check` 是 app-only，模型不要调用。

用户提到"演示插件 / 看看服务面板 / 部署 / 健康检查 / 审计日志 / 状态条"时按下面的规则用工具：

1. 让用户看服务：调 `show_dashboard`（可选 `filter`）。结果会以交互卡片渲染，不要把表格再复述一遍，一句话总结即可。再调一次会替换上一张卡片（同一个 `widgetSessionId`）。
2. 用户想在侧栏里看：调 `open_editor`。
3. 用户想要常驻的状态条：调 `show_status_banner`，它不进折叠区。
4. 用户想细看某个服务：调 `inspect_service`，参数 `name`。结果进侧栏的"服务监控"面板（未打开时内联显示）；服务名不存在会返回错误，如实转告。
5. 用户要看审计日志：调 `show_audit_log`（默认 1500 条；结果很大，宿主会省略持久化的结构化内容，卡片自己能重取，不用你重复调用）。
6. 用户要健康检查 / 诊断：调 `run_health_check`（约 1.5 秒，有进度），只总结返回的文本。
7. 用户要部署：调 `deploy`，参数 `service` 取用户说的服务名。工具执行中会向用户提问环境与确认，等待工具结果，不要自己替用户选。
8. 用户明确要求"模拟崩溃 / 演示重连"时才调 `simulate_crash`；其它情况不要调。
9. 卡片点过"Register experimental tool"之后才会出现 `forecast_capacity`；用户要容量预测且工具表里有它时再调。
10. `refresh_data`、`toggle_health`、`register_experimental_tool`、`cancellable_check` 是卡片内部按钮用的，模型永远看不到，也不要尝试调用。

卡片里"Ask model to summarize"会以用户身份发一条消息，消息卡片会标"来自插件 showcase"；这类消息按普通用户输入处理。带 ```json 块的后续消息是卡片附带的结构化数据。
