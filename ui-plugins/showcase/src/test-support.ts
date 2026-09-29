import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ElicitRequestSchema,
  LoggingMessageNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";

/** 测试用：真实拉起 server.mjs（stdio），并把四类 server 通知与 elicitation 自动作答记在实例上。 */
const SERVER = fileURLToPath(new URL("../dist/server.mjs", import.meta.url));

export interface ShowcaseToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: any;
  _meta?: Record<string, unknown>;
}

export interface ShowcaseClient {
  raw: Client;
  updated: string[];
  logs: Array<Record<string, unknown>>;
  toolListChanged: number;
  resourceListChanged: number;
  callTool(name: string, args?: Record<string, unknown>): Promise<ShowcaseToolResult>;
  close(): Promise<void>;
}

export async function startShowcaseClient(): Promise<ShowcaseClient> {
  // 客户端声明 elicitation 能力，deploy 的提问在这里自动作答（staging + confirm）。
  const raw = new Client({ name: "contract", version: "0" }, { capabilities: { elicitation: {} } });
  const client: ShowcaseClient = {
    raw,
    updated: [],
    logs: [],
    toolListChanged: 0,
    resourceListChanged: 0,
    callTool: async (name, args = {}) =>
      (await raw.callTool({ name, arguments: args })) as ShowcaseToolResult,
    close: () => raw.close(),
  };
  raw.setRequestHandler(ElicitRequestSchema, async () => ({
    action: "accept",
    content: { env: "staging", confirm: true },
  }));
  raw.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
    client.updated.push(n.params.uri);
  });
  raw.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
    client.logs.push(n.params as Record<string, unknown>);
  });
  raw.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    client.toolListChanged += 1;
  });
  raw.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
    client.resourceListChanged += 1;
  });
  await raw.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      stderr: "pipe",
      env: { ...process.env, SHOWCASE_REGION: "eu-west-1" },
    }),
  );
  return client;
}
