import { afterEach, beforeEach, expect, it } from "vitest";
import {
  ElicitRequestSchema,
  ProgressNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type ShowcaseClient, startShowcaseClient } from "./test-support";
import { SERVICES_JSON_URI } from "./contract";
let client: ShowcaseClient;
beforeEach(async () => {
  client = await startShowcaseClient();
});
afterEach(async () => {
  await client.close();
});

it("SC17：订阅后收到更新并可重读改变的服务；退订登记完成", async () => {
  const before = (await client.callTool("inspect_service", { name: "billing" })).structuredContent
    .service.healthy;
  const updated = new Promise<string>((resolve) =>
    client.raw.setNotificationHandler(ResourceUpdatedNotificationSchema, (event) =>
      resolve(event.params.uri),
    ),
  );
  await client.raw.subscribeResource({ uri: SERVICES_JSON_URI });
  await client.callTool("toggle_health", { service: "billing" });
  expect(await updated).toBe(SERVICES_JSON_URI);
  const resource = await client.raw.readResource({ uri: SERVICES_JSON_URI });
  expect(
    JSON.parse(String(resource.contents[0]!.text)).services.find(
      (entry: any) => entry.name === "billing",
    ).healthy,
  ).toBe(!before);
  await client.raw.unsubscribeResource({ uri: SERVICES_JSON_URI });
  expect(
    (await client.callTool("toggle_health", { service: "billing" })).structuredContent.notified,
  ).toBe(false);
});

it("SC18：动态注册发列表通知且第二次注册保持幂等", async () => {
  const changed = new Promise<void>((resolve) =>
    client.raw.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve()),
  );
  await client.callTool("register_experimental_tool");
  await changed;
  expect(
    (await client.callTool("register_experimental_tool")).structuredContent.alreadyRegistered,
  ).toBe(true);
  expect(
    (await client.raw.listTools()).tools.filter((tool) => tool.name === "forecast_capacity"),
  ).toHaveLength(1);
  expect(
    (await client.callTool("forecast_capacity", { service: "search" })).isError,
  ).toBeUndefined();
});

it("SC20/21：模型工具发五次递增进度与不健康日志", async () => {
  const progress: number[] = [];
  const received = new Promise<void>((resolve) =>
    client.raw.setNotificationHandler(ProgressNotificationSchema, (event) => {
      if (event.params.progressToken !== "showcase-progress") return;
      progress.push(event.params.progress);
      if (event.params.progress === 5) resolve();
    }),
  );
  // SDK 会在 response 到达时删除请求回调；直接观察带 token 的线通知，避免最后一条异步 handler 被响应清理吞掉。
  await client.raw.callTool({
    name: "run_health_check",
    arguments: {},
    _meta: { progressToken: "showcase-progress" },
  });
  await received;
  expect(progress).toEqual([1, 2, 3, 4, 5]);
  expect(client.logs).toContainEqual(expect.objectContaining({ level: "warning" }));
});

it("SC12：拒绝/取消不部署，接受后才产生部署记录", async () => {
  for (const action of ["decline", "cancel"] as const) {
    client.raw.setRequestHandler(ElicitRequestSchema, async () => ({ action }));
    await client.callTool("deploy", { service: "billing" });
    expect(
      (await client.callTool("inspect_service", { name: "billing" })).structuredContent.deployments,
    ).toHaveLength(0);
  }
  client.raw.setRequestHandler(ElicitRequestSchema, async () => ({
    action: "accept",
    content: { env: "staging", confirm: true },
  }));
  await client.callTool("deploy", { service: "billing" });
  expect(
    (await client.callTool("inspect_service", { name: "billing" })).structuredContent.deployments,
  ).toHaveLength(1);
});
