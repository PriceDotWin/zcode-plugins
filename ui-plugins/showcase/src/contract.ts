/**
 * 演示插件的对外合同：工具表、可见性、资源、面板与各类 structuredContent 形状。
 * 运行时是根目录 server.mjs / resources.mjs / data.mjs（导入即接 stdio）；src/contract.test.ts 真实拉起它校验一致。
 */
import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps";

export const PLUGIN_NAME = "showcase";
/** plugin.json 的 mcpServers 键；宿主工具名前缀 `mcp__plugin_<plugin>_<server>__`。 */
export const SERVER_NAME = "showcase";
export const HTML_MIME = "text/html;profile=mcp-app";
export const DASHBOARD_URI = "ui://showcase/dashboard.html";
export const CASES_URI = "ui://showcase/cases.html";
export const BANNER_URI = "ui://showcase/banner.html";
export const SERVICES_JSON_URI = "ui://showcase/live/services.json";
export const LOGO_URI = "ui://showcase/logo.png";
export const SERVICE_TEMPLATE = "ui://showcase/service/{name}.json";
export const EXPERIMENTAL_URI = "ui://showcase/experimental.json";
/** 清单 `ui.surfaces[0].id`；`inspect_service` 的 `_meta.ui.surface` 指向它。 */
export const SURFACE_ID = "monitor";
/** dashboard 结果的 `_meta["openai/widgetSessionId"]`：跨回合同一逻辑 UI，新结果替代旧卡片（SC25）。 */
export const WIDGET_SESSION_ID = "showcase-dashboard";
export const CASES_WIDGET_SESSION_ID = "showcase-cases";
export const PAGE_TOOL_NAME = "page_edit";
/** 工具级 CSP（dashboard.html 资源无 _meta，所以生效）。 */
export const CSP_CONNECT_DOMAINS = ["https://api.github.com"] as const;
/** 宿主持久化 structuredContent 的上限；show_audit_log 默认结果必须超过它（SC23）。 */
export const HOST_STRUCTURED_CONTENT_MAX_BYTES = 64 * 1024;
/** run_health_check 的进度通知次数与工具级超时（SC20）。 */
export const HEALTH_CHECK_PROGRESS_STEPS = 5;
export const HEALTH_CHECK_TIMEOUT_MS = 60000;

/** banner.html 资源项 `_meta`（SC24）：宿主以它为权威。 */
export const BANNER_RESOURCE_META = {
  ui: {
    csp: {
      connectDomains: ["https://api.github.com"],
      resourceDomains: ["https://github.com", "https://avatars.githubusercontent.com"],
      frameDomains: ["https://modelcontextprotocol.io"],
      baseUriDomains: ["https://showcase.zcode.example"],
    },
  },
  "openai/widgetPrefersBorder": true,
  "openai/widgetHeightHint": 72,
  "openai/widgetMinFrameHeight": 56,
  "openai/widgetShowCodexWidgetInline": true,
  "openai/widgetDomain": "https://showcase.zcode.example",
} as const satisfies { ui: McpUiResourceMeta; [key: string]: unknown };

export type Visibility = "model" | "app";
export interface ShowcaseTool {
  name: string;
  /** null = 无 UI 的普通工具；否则至少含 model 或 app。 */
  visibility: readonly Visibility[] | null;
  /** 有 UI 时的资源；app-only 数据工具可以没有（4a H03）。 */
  resourceUri?: string;
  fullscreen?: boolean;
  surface?: string;
  timeoutMs?: number;
  /** 连接后由 register_experimental_tool 动态注册，初始 tools/list 里没有。 */
  dynamic?: boolean;
  demonstrates: string;
}
export const TOOLS = [
  {
    name: "show_cases",
    visibility: ["model", "app"],
    resourceUri: CASES_URI,
    demonstrates: "SC01–SC53：完整能力导航与官方 SDK 实验室",
  },
  { name: "cancellable_check", visibility: ["app"], demonstrates: "SC34：只读检查与真实 MCP 取消" },
  {
    name: "show_failure",
    visibility: ["model", "app"],
    resourceUri: DASHBOARD_URI,
    demonstrates: "SC35：inline isError/异常不创建卡片",
  },
  {
    name: "show_failure_fullscreen",
    visibility: ["model", "app"],
    resourceUri: DASHBOARD_URI,
    fullscreen: true,
    demonstrates: "SC35：失败不自动开侧栏",
  },
  {
    name: "show_failure_pinned",
    visibility: ["model", "app"],
    resourceUri: DASHBOARD_URI,
    demonstrates: "SC35：失败不常驻固定",
  },
  {
    name: "show_dashboard",
    visibility: ["model", "app"],
    resourceUri: DASHBOARD_URI,
    demonstrates:
      "SC01 SC25：内联卡片、structuredContent、prefersBorder、工具级 csp、widgetSessionId",
  },
  {
    name: "open_editor",
    visibility: ["model", "app"],
    resourceUri: DASHBOARD_URI,
    fullscreen: true,
    demonstrates: "SC04：openai/ui.preferredModelDisplayMode fullscreen → 卡片一出现自动开侧栏",
  },
  {
    name: "show_status_banner",
    visibility: ["model", "app"],
    resourceUri: BANNER_URI,
    demonstrates:
      "SC24：openai/outputTemplate 别名 + 资源级 _meta（四类 csp、heightHint、minFrameHeight、showInline）",
  },
  {
    name: "inspect_service",
    visibility: ["model", "app"],
    resourceUri: DASHBOARD_URI,
    surface: SURFACE_ID,
    demonstrates: "SC13 SC14：_meta.ui.surface 进面板；未知服务 isError 不覆盖面板快照",
  },
  {
    name: "show_audit_log",
    visibility: ["model", "app"],
    resourceUri: DASHBOARD_URI,
    demonstrates: "SC23：structuredContent > 64 KiB 被宿主省略，页面 callTool 重取",
  },
  {
    name: "run_health_check",
    visibility: null,
    timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
    demonstrates:
      "SC20 SC21：5 次 notifications/progress + 工具级 timeoutMs；不健康服务发 logging warning",
  },
  {
    name: "deploy",
    visibility: null,
    demonstrates: "SC12 SC17：执行中 elicitInput 向用户提问；成功后发 services.json updated",
  },
  {
    name: "simulate_crash",
    visibility: null,
    demonstrates: "SC19：回包后退出进程，agent 重连并重放订阅",
  },
  {
    name: "forecast_capacity",
    visibility: null,
    dynamic: true,
    demonstrates: "SC18：register_experimental_tool 后动态出现，tools/list_changed",
  },
  {
    name: "refresh_data",
    visibility: ["app"],
    resourceUri: DASHBOARD_URI,
    demonstrates: "SC02 SC03：app-only（有 resourceUri），只允许页面回调",
  },
  {
    name: "toggle_health",
    visibility: ["app"],
    demonstrates: "SC02 SC17：app-only（无 resourceUri）数据工具，触发资源通知",
  },
  {
    name: "register_experimental_tool",
    visibility: ["app"],
    demonstrates: "SC18：动态注册 forecast_capacity 与 experimental.json，两类 list_changed",
  },
] as const satisfies readonly ShowcaseTool[];
export type ShowcaseToolName = (typeof TOOLS)[number]["name"];

export interface ShowcaseResource {
  uri: string;
  mimeType: string;
  /** true = 只在 register_experimental_tool 之后出现。 */
  dynamic?: boolean;
}
export const RESOURCES = [
  { uri: CASES_URI, mimeType: HTML_MIME },
  { uri: DASHBOARD_URI, mimeType: HTML_MIME },
  { uri: BANNER_URI, mimeType: HTML_MIME },
  { uri: SERVICES_JSON_URI, mimeType: "application/json" },
  { uri: LOGO_URI, mimeType: "image/png" },
  { uri: EXPERIMENTAL_URI, mimeType: "application/json", dynamic: true },
] as const satisfies readonly ShowcaseResource[];

export type ServiceEnv = "prod" | "staging" | "dev";
export type DashboardFilter = ServiceEnv | "all";
export interface ServiceRow {
  name: string;
  env: ServiceEnv;
  version: string;
  healthy: boolean;
  latencyMs: number;
}
export interface DeploymentRecord {
  service: string;
  env: ServiceEnv;
  at: string;
  version: string;
}
/** show_dashboard / open_editor / refresh_data 的 structuredContent。 */
export interface DashboardSnapshot {
  kind: "dashboard";
  generatedAt: string;
  refreshCount: number;
  filter: DashboardFilter;
  /** 清单 userConfig.region → env SHOWCASE_REGION（SC31）。 */
  region: string;
  rows: ServiceRow[];
  deployments: DeploymentRecord[];
}
/** show_status_banner 的 structuredContent。 */
export interface BannerSnapshot {
  kind: "banner";
  region: string;
  healthy: number;
  total: number;
  lastDeployment: DeploymentRecord | null;
}
/** inspect_service 的 structuredContent（也是 service/{name}.json 模板的内容）。 */
export interface ServiceDetail {
  kind: "service";
  service: ServiceRow;
  history: Array<{ minute: number; latencyMs: number }>;
  deployments: DeploymentRecord[];
}
/** show_audit_log 的 structuredContent。 */
export interface AuditLog {
  kind: "audit";
  total: number;
  entries: Array<{
    id: string;
    at: string;
    service: string;
    action: string;
    actor: string;
    detail: string;
  }>;
}

/** show_cases 的目录定位结果；目录具体步骤来自 cases.json。 */
export interface CasesSnapshot {
  kind: "cases";
  version: string;
  total: number;
  caseId: string;
}
