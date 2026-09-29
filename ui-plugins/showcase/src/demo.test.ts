import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { type ShowcaseClient, startShowcaseClient } from "./test-support";
import { casesExample } from "./contract.example";
import { CASES_WIDGET_SESSION_ID } from "./contract";

let client: ShowcaseClient;
beforeAll(async () => {
  client = await startShowcaseClient();
});
afterAll(async () => {
  await client.close();
});

it("package、插件清单、本地市场与实际 server 版本一致", async () => {
  const read = async (path: string) =>
    JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
  const [pkg, manifest, marketplace] = await Promise.all([
    read("../package.json"),
    read("../../../plugins/showcase/.zcode-plugin/plugin.json"),
    read("../../../marketplace.json"),
  ]);
  expect(manifest.version).toBe(pkg.version);
  expect(marketplace.plugins.find((item: any) => item.name === manifest.name)).toMatchObject({
    name: manifest.name,
    version: pkg.version,
    source: "./plugins/showcase",
  });
  expect(client.raw.getServerVersion()?.version).toBe(pkg.version);
});

it("完整目录区分直接、配合、自动化和待实现，所有提示词工具与真实 server 一致", async () => {
  const cases = JSON.parse(await readFile(new URL("../cases.json", import.meta.url), "utf8"));
  expect(cases.map((item: any) => item.id)).toEqual(
    Array.from({ length: 53 }, (_, i) => `SC${String(i + 1).padStart(2, "0")}`),
  );
  const tools = new Set((await client.raw.listTools()).tools.map((tool) => tool.name));
  for (const item of cases) {
    expect(["direct", "guided", "fixture", "pending"]).toContain(item.mode);
    for (const language of ["zh", "en"]) {
      for (const field of ["title", "steps", "expected"])
        expect(item[field][language].length).toBeGreaterThan(0);
    }
    if (item.tool) expect(tools.has(item.tool)).toBe(true);
    if (item.mode === "direct") expect(item.target).toBeTruthy();
    if (item.mode === "fixture") expect(item.command).toContain("mcp-apps-host-e2e.mjs");
    if (item.mode === "pending") expect(item.tool).toBeUndefined();
  }
  expect(cases.filter((item: any) => item.mode === "pending").map((item: any) => item.id)).toEqual([
    "SC51",
    "SC52",
  ]);
});

it("show_cases 使用独立逻辑页面，实际构建资源包含 SDK 与目录", async () => {
  const result = await client.callTool("show_cases", { caseId: "SC36" });
  expect(result.structuredContent).toMatchObject({ kind: "cases", caseId: "SC36", total: 53 });
  expect(result.structuredContent).toEqual(casesExample);
  expect(result._meta?.["openai/widgetSessionId"]).toBe(CASES_WIDGET_SESSION_ID);
  const page = await client.raw.readResource({ uri: "ui://showcase/cases.html" });
  const html = String(page.contents[0]!.text);
  expect(html).toContain("sampling");
  expect(html).not.toContain("__SHOWCASE_CLIENT__");
  expect(html).not.toMatch(/<script[^>]+src=/);
});

it("失败演示返回真实 MCP 错误，保留展示元数据供宿主判定", async () => {
  const tools = (await client.raw.listTools()).tools;
  for (const name of ["show_failure", "show_failure_fullscreen", "show_failure_pinned"]) {
    expect(tools.find((tool) => tool.name === name)?._meta).toHaveProperty("ui.resourceUri");
    expect((await client.callTool(name)).isError).toBe(true);
    expect((await client.callTool(name, { throwError: true })).isError).toBe(true);
  }
  expect(
    (await client.callTool("show_dashboard", { demoTab: "resources" })).isError,
  ).toBeUndefined();
});

it("长检查仅 app 可见；取消后新调用正常完成，不改变服务数据", async () => {
  const tool = (await client.raw.listTools()).tools.find(
    (entry) => entry.name === "cancellable_check",
  );
  expect(tool?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  const before = (await client.callTool("show_dashboard")).structuredContent.rows;
  const controller = new AbortController();
  // 以 server 的开始日志作为屏障，避免测试靠睡眠猜测是否已接纳。
  const { LoggingMessageNotificationSchema } = await import("@modelcontextprotocol/sdk/types.js");
  const started = new Promise<void>((resolve) =>
    client.raw.setNotificationHandler(LoggingMessageNotificationSchema, (event) => {
      if (event.params.data?.event === "check-started") resolve();
    }),
  );
  const pending = client.raw.callTool(
    { name: "cancellable_check", arguments: { durationMs: 10_000 } },
    undefined,
    { signal: controller.signal },
  );
  await started;
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(
    (await client.callTool("cancellable_check", { durationMs: 1 })).structuredContent,
  ).toMatchObject({ kind: "check", completed: true });
  const stable = (rows: any[]) => rows.map(({ latencyMs: _latency, ...row }) => row);
  expect(stable((await client.callTool("show_dashboard")).structuredContent.rows)).toEqual(
    stable(before),
  );
});
