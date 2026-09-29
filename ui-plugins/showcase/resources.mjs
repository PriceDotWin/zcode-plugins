// showcase 的 MCP 资源：三个 ui:// 页面、可订阅的 services.json、
// PNG blob、资源模板，以及 register_experimental_tool 动态追加的 experimental.json。
// 订阅登记只在进程内存：simulate_crash 后清零，靠 agent 侧登记表在重连时重放（SC19）。
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SERVICES, serviceDetail, servicesJson } from "./data.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
export const HTML_MIME = "text/html;profile=mcp-app";
export const DASHBOARD_URI = "ui://showcase/dashboard.html";
export const CASES_URI = "ui://showcase/cases.html";
export const BANNER_URI = "ui://showcase/banner.html";
export const SERVICES_JSON_URI = "ui://showcase/live/services.json";
export const LOGO_URI = "ui://showcase/logo.png";
export const SERVICE_TEMPLATE = "ui://showcase/service/{name}.json";
export const EXPERIMENTAL_URI = "ui://showcase/experimental.json";
// 24×24 蓝色圆环 PNG（149 字节），readResource blob 与 downloadFile resource_link 都用它。
export const LOGO_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAXElEQVR42mP4TyXAMKQM4sy8hYZINgjTCILGMZBqCi6zGPCbQqQUukHEBAcuNdgNwh9BBAwiMnZwqWQg1Tm4FI8sgygNbKpFPzUTJNWyCDUzLTWLEWoWbMOi8AcAL9fF/A/+rLoAAAAASUVORK5CYII=";

/**
 * banner.html 资源项自己的 `_meta`（SC24）：宿主以它为权威，工具级 `openai/widgetCSP` 只是兜底。
 * 四类 CSP 域都声明；heightHint 作卡片初始高度，minFrameHeight 抬 clamp 下限；showInline 强制常驻不进折叠区。
 */
export const BANNER_META = {
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
};

const subscribedUris = new Set();

export function registerResources(server) {
  server.registerResource(
    "cases",
    CASES_URI,
    { mimeType: HTML_MIME, description: "Complete case directory and official SDK laboratory" },
    async () => ({
      contents: [{ uri: CASES_URI, mimeType: HTML_MIME, text: await readPage("cases.html") }],
    }),
  );
  // 订阅登记（SC17）：宿主只在 server 声明 resources.subscribe 时代理 resources/subscribe。
  server.server.setRequestHandler(SubscribeRequestSchema, async ({ params }) => {
    subscribedUris.add(params.uri);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async ({ params }) => {
    subscribedUris.delete(params.uri);
    return {};
  });

  server.registerResource(
    "dashboard",
    DASHBOARD_URI,
    {
      mimeType: HTML_MIME,
      description: "Showcase dashboard widget (inline card / side pane / monitor surface)",
    },
    async () => ({
      contents: [{ uri: DASHBOARD_URI, mimeType: HTML_MIME, text: await readPage("index.html") }],
    }),
  );
  server.registerResource(
    "banner",
    BANNER_URI,
    {
      mimeType: HTML_MIME,
      description: "Status banner with resource-level _meta (csp / height hints / showInline)",
    },
    async () => ({
      contents: [
        {
          uri: BANNER_URI,
          mimeType: HTML_MIME,
          text: await readPage("banner.html"),
          _meta: BANNER_META,
        },
      ],
    }),
  );
  server.registerResource(
    "services-live",
    SERVICES_JSON_URI,
    {
      mimeType: "application/json",
      description: "Live service table; subscribe to get resources/updated",
    },
    async () => ({
      contents: [{ uri: SERVICES_JSON_URI, mimeType: "application/json", text: servicesJson() }],
    }),
  );
  server.registerResource(
    "logo",
    LOGO_URI,
    { mimeType: "image/png", description: "24x24 PNG logo (binary blob)" },
    async () => ({ contents: [{ uri: LOGO_URI, mimeType: "image/png", blob: LOGO_PNG_BASE64 }] }),
  );
  // 资源模板（SC16）：list 列出每个服务的具体 URI，complete 给 name 变量补全。
  server.registerResource(
    "service",
    new ResourceTemplate(SERVICE_TEMPLATE, {
      list: async () => ({
        resources: SERVICES.map((service) => ({
          uri: SERVICE_TEMPLATE.replace("{name}", service.name),
          name: `service:${service.name}`,
          mimeType: "application/json",
        })),
      }),
      complete: {
        name: (value) => SERVICES.map((s) => s.name).filter((name) => name.startsWith(value)),
      },
    }),
    { mimeType: "application/json", description: "Per-service detail, e.g. service/billing.json" },
    async (uri, variables) => {
      const detail = serviceDetail(String(variables.name));
      if (!detail) throw new Error(`Unknown service: ${String(variables.name)}`);
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(detail, null, 2) },
        ],
      };
    },
  );
}

/** 订阅过的资源才发 notifications/resources/updated（没人订阅就静默）。 */
export async function notifyResourceUpdated(server, uri) {
  if (!subscribedUris.has(uri)) return false;
  await server.server.sendResourceUpdated({ uri });
  return true;
}

/** SC18：连接后再注册资源，McpServer 自动发 notifications/resources/list_changed。 */
export function registerExperimentalResource(server) {
  server.registerResource(
    "experimental",
    EXPERIMENTAL_URI,
    { mimeType: "application/json", description: "Appears after register_experimental_tool" },
    async () => ({
      contents: [
        {
          uri: EXPERIMENTAL_URI,
          mimeType: "application/json",
          text: JSON.stringify({
            registeredAt: new Date().toISOString(),
            tool: "forecast_capacity",
          }),
        },
      ],
    }),
  );
}

async function readPage(file) {
  const html = await readFile(join(ROOT, "ui", file), "utf8");
  if (html.includes("__SHOWCASE_CLIENT__"))
    throw new Error(
      "Build Showcase first and launch dist/server.mjs (pnpm --filter @zcode/plugin-showcase build)",
    );
  return html;
}
