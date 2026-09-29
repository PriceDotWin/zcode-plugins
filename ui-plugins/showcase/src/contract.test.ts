import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BANNER_RESOURCE_META,
  BANNER_URI,
  CSP_CONNECT_DOMAINS,
  DASHBOARD_URI,
  HEALTH_CHECK_TIMEOUT_MS,
  HOST_STRUCTURED_CONTENT_MAX_BYTES,
  HTML_MIME,
  LOGO_URI,
  PLUGIN_NAME,
  RESOURCES,
  SERVICE_TEMPLATE,
  SURFACE_ID,
  TOOLS,
  WIDGET_SESSION_ID,
} from "./contract";
import {
  auditExample,
  bannerExample,
  dashboardExample,
  serviceDetailExample,
} from "./contract.example";
import { type ShowcaseClient, startShowcaseClient } from "./test-support";

// 静态合同：工具表、资源、structuredContent 形状。订阅 / 进度 / 日志 / 动态注册见 notifications.test.ts。
let client: ShowcaseClient;
beforeAll(async () => {
  client = await startShowcaseClient();
});
afterAll(async () => {
  await client.close();
});

describe("showcase contract", () => {
  it("server 能力与初始工具表、可见性、surface、timeoutMs、fullscreen 偏好与合同一致", async () => {
    expect(client.raw.getServerVersion()?.name).toBe(PLUGIN_NAME);
    expect(client.raw.getServerCapabilities()).toMatchObject({
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      logging: {},
    });
    const tools = (await client.raw.listTools()).tools;
    const expected = TOOLS.filter((t) => !("dynamic" in t)).map((t) => t.name);
    expect(tools.map((t) => t.name).sort()).toEqual([...expected].sort());
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const tool of TOOLS) {
      if ("dynamic" in tool) continue;
      const meta: any = byName[tool.name]!._meta ?? {};
      if (tool.visibility === null) {
        expect(meta.ui).toBeUndefined();
        expect(meta["openai/outputTemplate"]).toBeUndefined();
      } else if (tool.name === "show_status_banner") {
        // 工具级只用 兼容元数据别名；csp / prefersBorder 由资源级 _meta 覆盖。
        expect(meta["openai/outputTemplate"]).toBe(BANNER_URI);
        expect(meta["openai/widgetCSP"]).toEqual({
          connect_domains: ["https://example.com"],
          resource_domains: [],
        });
        expect(meta["openai/widgetPrefersBorder"]).toBe(false);
      } else {
        expect(meta.ui).toMatchObject({ visibility: tool.visibility });
        if ("resourceUri" in tool) expect(meta.ui.resourceUri).toBe(tool.resourceUri);
        else expect(meta.ui.resourceUri).toBeUndefined();
      }
      if ("fullscreen" in tool)
        expect(meta["openai/ui"]).toEqual({ preferredModelDisplayMode: "fullscreen" });
      else expect(meta["openai/ui"]).toBeUndefined();
      if ("surface" in tool) expect(meta.ui.surface).toBe(SURFACE_ID);
      if ("timeoutMs" in tool) expect(meta.timeoutMs).toBe(tool.timeoutMs);
    }
    expect(byName.show_dashboard!._meta).toMatchObject({
      ui: { prefersBorder: true, csp: { connectDomains: [...CSP_CONNECT_DOMAINS] } },
    });
    expect(byName.run_health_check!._meta).toEqual({ timeoutMs: HEALTH_CHECK_TIMEOUT_MS });
  });

  it("资源列表 / 模板 / 页面 / blob / 资源级 _meta 与合同一致", async () => {
    const listed = (await client.raw.listResources()).resources;
    for (const resource of RESOURCES) {
      if ("dynamic" in resource) expect(listed.find((r) => r.uri === resource.uri)).toBeUndefined();
      else
        expect(listed).toContainEqual(
          expect.objectContaining({ uri: resource.uri, mimeType: resource.mimeType }),
        );
    }
    // 模板：list 回调把每个服务列成具体资源。
    expect(
      listed.filter((r) => r.uri.startsWith("ui://showcase/service/")).length,
    ).toBeGreaterThan(0);
    const templates = (await client.raw.listResourceTemplates()).resourceTemplates;
    expect(templates).toContainEqual(
      expect.objectContaining({ uriTemplate: SERVICE_TEMPLATE, mimeType: "application/json" }),
    );

    const page = await client.raw.readResource({ uri: DASHBOARD_URI });
    expect(page.contents[0]).toMatchObject({ uri: DASHBOARD_URI, mimeType: HTML_MIME });
    expect(page.contents[0]!.text).toContain("<");
    expect(page.contents[0]!._meta).toBeUndefined();
    const banner = await client.raw.readResource({ uri: BANNER_URI });
    expect(banner.contents[0]).toMatchObject({
      uri: BANNER_URI,
      mimeType: HTML_MIME,
      _meta: BANNER_RESOURCE_META,
    });
    const logo = await client.raw.readResource({ uri: LOGO_URI });
    const bytes = Buffer.from(logo.contents[0]!.blob as string, "base64");
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const detail = await client.raw.readResource({
      uri: SERVICE_TEMPLATE.replace("{name}", "billing"),
    });
    const parsed = JSON.parse(detail.contents[0]!.text as string);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(serviceDetailExample).sort());
    expect(parsed.service.name).toBe("billing");
    await expect(
      client.raw.readResource({ uri: SERVICE_TEMPLATE.replace("{name}", "nope") }),
    ).rejects.toThrow(/Unknown service/);
  });

  it("show_dashboard：DashboardSnapshot 形状、region 来自 env、widgetSessionId", async () => {
    const result = await client.callTool("show_dashboard", { filter: "prod" });
    expect(result.isError).toBeUndefined();
    expect(result._meta).toMatchObject({ "openai/widgetSessionId": WIDGET_SESSION_ID });
    const snapshot = result.structuredContent;
    expect(Object.keys(snapshot).sort()).toEqual(Object.keys(dashboardExample).sort());
    expect(snapshot).toMatchObject({
      kind: "dashboard",
      filter: "prod",
      region: "eu-west-1",
      refreshCount: expect.any(Number),
    });
    expect(new Date(snapshot.generatedAt).toISOString()).toBe(snapshot.generatedAt);
    expect(snapshot.rows.length).toBeGreaterThan(0);
    for (const row of snapshot.rows) {
      expect(Object.keys(row).sort()).toEqual(Object.keys(dashboardExample.rows[0]!).sort());
      expect(row.env).toBe("prod");
    }
    const banner = await client.callTool("show_status_banner");
    expect(Object.keys(banner.structuredContent).sort()).toEqual(Object.keys(bannerExample).sort());
    expect(banner.structuredContent).toMatchObject({
      kind: "banner",
      region: "eu-west-1",
      total: 4,
    });
  });

  it("inspect_service：已知服务返回 ServiceDetail，未知服务 isError", async () => {
    const ok = await client.callTool("inspect_service", { name: "billing" });
    expect(ok.isError).toBeUndefined();
    expect(Object.keys(ok.structuredContent).sort()).toEqual(
      Object.keys(serviceDetailExample).sort(),
    );
    expect(ok.structuredContent.history).toHaveLength(12);
    const bad = await client.callTool("inspect_service", { name: "nosuch" });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent).toBeUndefined();
  });

  it("show_audit_log：默认结果超过宿主 64 KiB 上限，显式 entries 精确生效", async () => {
    const big = await client.callTool("show_audit_log");
    expect(Buffer.byteLength(JSON.stringify(big.structuredContent), "utf8")).toBeGreaterThan(
      HOST_STRUCTURED_CONTENT_MAX_BYTES,
    );
    expect(big.structuredContent.total).toBe(1500);
    const small = await client.callTool("show_audit_log", { entries: 10 });
    expect(small.structuredContent.entries).toHaveLength(10);
    expect(Object.keys(small.structuredContent).sort()).toEqual(Object.keys(auditExample).sort());
    expect(Object.keys(small.structuredContent.entries[0]).sort()).toEqual(
      Object.keys(auditExample.entries[0]!).sort(),
    );
  });
});
