#!/usr/bin/env node
// ZCode 插件 UI 演示服务。一个 stdio MCP server，完整目录编号 SC01–SC53
// 保留基础能力并由能力实验室补齐当前宿主场景；数据在 data.mjs，资源在 resources.mjs，页面在 ui/*.html（宿主注入 window.zcode）。
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerDemoTools } from "./demo-tools.mjs";
import {
  auditLog,
  bannerSnapshot,
  forecast,
  recordDeployment,
  serviceDetail,
  snapshot,
  toggleHealth,
} from "./data.mjs";
import {
  BANNER_URI,
  DASHBOARD_URI,
  EXPERIMENTAL_URI,
  SERVICES_JSON_URI,
  notifyResourceUpdated,
  registerExperimentalResource,
  registerResources,
} from "./resources.mjs";

// 工具级 CSP（SC01）：dashboard.html 资源没有 _meta，所以这里的声明生效；banner.html 有资源级 _meta，工具级只是兜底。
const CSP = { connectDomains: ["https://api.github.com"], resourceDomains: [] };
// SC25：同一逻辑 UI 的身份。带它的结果跨回合互相替代（旧卡片变占位），不带的各自保留。
const WIDGET_SESSION_ID = "showcase-dashboard";
const FILTER = z.enum(["all", "prod", "staging", "dev"]).optional();

const server = new McpServer(
  { name: "showcase", version: "0.4.2" },
  {
    capabilities: {
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      logging: {},
    },
  },
);

registerDemoTools(server);

function dashboardResult(filter, note) {
  const data = snapshot(filter);
  const unhealthy = data.rows.filter((r) => !r.healthy).length;
  const summary = `${data.rows.length} services (${unhealthy} unhealthy)${note ? `. ${note}` : ""}`;
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: data,
    _meta: { "openai/widgetSessionId": WIDGET_SESSION_ID, showcase: { source: "server.mjs" } },
  };
}

// SC01：内联卡片。
server.registerTool(
  "show_dashboard",
  {
    description:
      "Show the service dashboard as an interactive inline widget. Use when the user asks to see services, deployments, health, or wants the plugin demo.",
    inputSchema: {
      filter: FILTER,
      demoTab: z.enum(["data", "actions", "state", "resources", "files", "host", "log"]).optional(),
    },
    _meta: {
      ui: {
        resourceUri: DASHBOARD_URI,
        visibility: ["model", "app"],
        prefersBorder: true,
        csp: CSP,
      },
    },
  },
  async ({ filter }) => dashboardResult(filter),
);

// SC04：偏好 fullscreen，卡片一出现自动开侧栏。
server.registerTool(
  "open_editor",
  {
    description:
      "Open the service dashboard in the side pane (fullscreen widget) for detailed editing.",
    inputSchema: { filter: FILTER },
    _meta: {
      ui: { resourceUri: DASHBOARD_URI, visibility: ["model", "app"], csp: CSP },
      "openai/ui": { preferredModelDisplayMode: "fullscreen" },
    },
  },
  async ({ filter }) => dashboardResult(filter, "Opened in side pane."),
);

// SC24：资源级 _meta 演示。工具级故意只用 兼容元数据别名（outputTemplate / widgetCSP snake_case / widgetPrefersBorder），
// 宿主先读 banner.html 资源项的 _meta，这里的 csp 与 prefersBorder 都不会生效。
server.registerTool(
  "show_status_banner",
  {
    description:
      "Show a compact always-visible status banner (region, healthy count, last deployment). Use when the user wants a persistent status strip.",
    inputSchema: {},
    _meta: {
      "openai/outputTemplate": BANNER_URI,
      "openai/widgetCSP": { connect_domains: ["https://example.com"], resource_domains: [] },
      "openai/widgetPrefersBorder": false,
    },
  },
  async () => {
    const data = bannerSnapshot();
    return {
      content: [{ type: "text", text: `${data.healthy}/${data.total} healthy in ${data.region}` }],
      structuredContent: data,
    };
  },
);

// SC13 / SC14：结果归属清单面板 monitor；未知服务返回 isError，面板保留上一份成功快照。
server.registerTool(
  "inspect_service",
  {
    description:
      "Inspect one service in the Monitor panel: current status, 12-minute latency history and recent deployments. Fails for unknown names.",
    inputSchema: { name: z.string().describe("Service name, e.g. billing") },
    _meta: { ui: { resourceUri: DASHBOARD_URI, visibility: ["model", "app"], surface: "monitor" } },
  },
  async ({ name }) => {
    const detail = serviceDetail(name);
    if (!detail) {
      return { content: [{ type: "text", text: `Unknown service "${name}".` }], isError: true };
    }
    return {
      content: [
        {
          type: "text",
          text: `${name}: ${detail.service.healthy ? "healthy" : "UNHEALTHY"}, ${detail.service.latencyMs} ms, ${detail.service.env} ${detail.service.version}`,
        },
      ],
      structuredContent: detail,
    };
  },
);

// SC23：结构化结果超过 64 KiB，宿主整个省略并标 truncated；页面用 callTool 重取（visibility 含 app）。
server.registerTool(
  "show_audit_log",
  {
    description:
      "Show the deployment audit log widget. Default 1500 entries (the host truncates persisted structured content above 64 KiB; the widget re-fetches on demand).",
    inputSchema: { entries: z.number().int().min(1).max(5000).optional() },
    _meta: { ui: { resourceUri: DASHBOARD_URI, visibility: ["model", "app"] } },
  },
  async ({ entries }) => {
    const data = auditLog(entries);
    return {
      content: [{ type: "text", text: `${data.total} audit entries.` }],
      structuredContent: data,
    };
  },
);

// SC20 / SC21：5 次进度通知 + 工具级 60 s 超时；对不健康服务发 warning 日志通知（进 agent 日志 mcp:<server>）。
server.registerTool(
  "run_health_check",
  {
    description:
      "Run a health check across services (about 1.5 s, reports progress). Use when the user asks to check health or run diagnostics.",
    inputSchema: { service: z.string().optional() },
    _meta: { timeoutMs: 60000 },
  },
  async ({ service }, extra) => {
    const rows = snapshot("all").rows.filter((r) => !service || r.name === service);
    const progressToken = extra?._meta?.progressToken;
    for (let step = 1; step <= 5; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (progressToken !== undefined && extra?.sendNotification) {
        await extra.sendNotification({
          method: "notifications/progress",
          params: { progressToken, progress: step, total: 5, message: `probe ${step}/5` },
        });
      }
    }
    for (const row of rows.filter((r) => !r.healthy)) {
      await server.server.sendLoggingMessage({
        level: "warning",
        logger: "showcase",
        data: { service: row.name, env: row.env, latencyMs: row.latencyMs, message: "unhealthy" },
      });
    }
    const unhealthy = rows.filter((r) => !r.healthy).map((r) => r.name);
    return {
      content: [
        {
          type: "text",
          text: unhealthy.length
            ? `Checked ${rows.length} services; unhealthy: ${unhealthy.join(", ")}.`
            : `Checked ${rows.length} services; all healthy.`,
        },
      ],
      structuredContent: { kind: "health", checked: rows.length, unhealthy },
    };
  },
);

// SC12：执行中用 elicitation 向用户确认；成功后写部署记录并通知 services.json 订阅者（SC17）。
server.registerTool(
  "deploy",
  {
    description:
      "Deploy a service. Asks the user (via MCP elicitation) which environment to target and whether to proceed before doing anything.",
    inputSchema: { service: z.string().describe("Service name, e.g. billing") },
  },
  async ({ service }) => {
    const result = await server.server.elicitInput({
      message: `Deploy ${service}: choose the target environment and confirm.`,
      requestedSchema: {
        type: "object",
        properties: {
          env: {
            type: "string",
            title: "Environment",
            enum: ["dev", "staging", "prod"],
            enumNames: ["Dev", "Staging", "Prod"],
          },
          confirm: { type: "boolean", title: "Proceed", description: "Start the deployment now?" },
        },
        required: ["env", "confirm"],
      },
    });
    if (result.action !== "accept") {
      return {
        content: [
          { type: "text", text: `Deployment of ${service} ${result.action}ed by the user.` },
        ],
      };
    }
    const { env, confirm } = result.content ?? {};
    if (!confirm) {
      return {
        content: [
          { type: "text", text: `User chose ${env} but did not confirm; nothing deployed.` },
        ],
      };
    }
    const record = recordDeployment(service, env);
    const notified = await notifyResourceUpdated(server, SERVICES_JSON_URI);
    return {
      content: [{ type: "text", text: `Deployed ${service} to ${env}.` }],
      structuredContent: {
        service,
        env,
        confirmed: true,
        elicitation: result.content,
        record,
        notified,
      },
    };
  },
);

// SC19：回包后退出进程。agent 下一次调用时重连并重放订阅登记；本进程的内存状态全部归零。
server.registerTool(
  "simulate_crash",
  {
    description:
      "Demo only: reply, then exit the plugin MCP server process to show automatic reconnection and subscription replay. Only call when the user explicitly asks to simulate a crash.",
    inputSchema: {},
  },
  async () => {
    setTimeout(() => process.exit(0), 150);
    return {
      content: [{ type: "text", text: "Showcase server exiting now; the next call reconnects." }],
    };
  },
);

// ---- app-only（SC02）：只允许页面 callTool，永不进模型 tools ----

server.registerTool(
  "refresh_data",
  {
    description: "App-only: refresh dashboard data. Never advertised to the model.",
    inputSchema: { filter: FILTER },
    _meta: { ui: { resourceUri: DASHBOARD_URI, visibility: ["app"] } },
  },
  async ({ filter }) => dashboardResult(filter, "Refreshed from widget."),
);

// 无 resourceUri 的 app-only 数据工具（4a H03）：翻转健康态并通知订阅者（SC17 / SC19）。
server.registerTool(
  "toggle_health",
  {
    description:
      "App-only: flip the healthy flag of a service and notify services.json subscribers.",
    inputSchema: { service: z.string() },
    _meta: { ui: { visibility: ["app"] } },
  },
  async ({ service }) => {
    const toggled = toggleHealth(service);
    if (!toggled) {
      return { content: [{ type: "text", text: `Unknown service "${service}".` }], isError: true };
    }
    const notified = await notifyResourceUpdated(server, SERVICES_JSON_URI);
    return {
      content: [
        { type: "text", text: `${service} is now ${toggled.healthy ? "healthy" : "unhealthy"}.` },
      ],
      structuredContent: { service: toggled, notified, rows: snapshot("all").rows },
    };
  },
);

// SC18：连接后动态注册一个模型可见工具与一个资源；McpServer 自动发 tools/list_changed 与 resources/list_changed，
// agent 在下一回合开始前重拉工具表。
let experimentalTool = null;
server.registerTool(
  "register_experimental_tool",
  {
    description:
      "App-only: register the experimental forecast_capacity tool and experimental.json resource at runtime.",
    inputSchema: {},
    _meta: { ui: { visibility: ["app"] } },
  },
  async () => {
    const alreadyRegistered = experimentalTool !== null;
    if (!alreadyRegistered) {
      experimentalTool = server.registerTool(
        "forecast_capacity",
        {
          description:
            "Forecast 30-day latency and give a scaling recommendation per service. Registered at runtime by the showcase widget.",
          inputSchema: { service: z.string().optional() },
        },
        async ({ service }) => {
          const data = forecast(service);
          return {
            content: [
              {
                type: "text",
                text: `Forecast for ${data.rows.length} services over ${data.horizonDays} days.`,
              },
            ],
            structuredContent: data,
          };
        },
      );
      registerExperimentalResource(server);
    }
    return {
      content: [
        {
          type: "text",
          text: alreadyRegistered ? "Already registered." : "Registered forecast_capacity.",
        },
      ],
      structuredContent: {
        registered: true,
        alreadyRegistered,
        tool: "forecast_capacity",
        resource: EXPERIMENTAL_URI,
      },
    };
  },
);

registerResources(server);
await server.connect(new StdioServerTransport());
