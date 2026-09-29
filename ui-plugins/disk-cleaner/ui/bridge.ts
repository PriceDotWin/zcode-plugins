import { App } from "@modelcontextprotocol/ext-apps";
import {
  CleanerError,
  type CleanerErrorCode,
  type ListPage,
  type ListQuery,
  type Status,
} from "#cleaner/contract.ts";

const app = new App(
  { name: "disk-cleaner", version: "0.1.1" },
  {},
  { autoResize: false },
);
let connection: Promise<void> | undefined;
// 先注册处理器再连接，避免初始化期间的主题或工具通知丢失。
app.onhostcontextchanged = () => window.dispatchEvent(new Event("plugin:hostchange"));
app.ontoolresult = () => window.dispatchEvent(new Event("plugin:toolresult"));
const ready = () =>
  (connection ??= app.connect().then(() => {
    window.dispatchEvent(new Event("plugin:hostchange"));
  }));

export const host = {
  get context() {
    return app.getHostContext();
  },
  notifyIntrinsicHeight(height: number) {
    void ready()
      .then(() => app.sendSizeChanged({ height }))
      .catch(() => undefined);
  },
};

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  await ready();
  const result = await app.callServerTool({ name, arguments: args });
  const content = result.structuredContent as Record<string, unknown> | undefined;
  const error = content?.error as { code?: string; message?: string } | undefined;
  if (result.isError || error) {
    const text = (result.content?.[0] as { text?: string } | undefined)?.text;
    throw new CleanerError(
      (error?.code ?? "invalid_input") as CleanerErrorCode,
      error?.message ?? text ?? "Tool failed",
    );
  }
  return content as T;
}

/** 面板只经这些 app 工具读写；状态唯一所有者在 server 的 Cleaner。 */
export const api = {
  status: () => call<Status>("get_status"),
  scan: (path: string, minBytes: number) => call<Status>("scan_directory", { path, minBytes }),
  cancel: (scanId: string) => call<Status>("cancel_scan", { scanId }),
  list: (query: ListQuery) => call<ListPage>("list_files", { ...query }),
  prepare: (scanId: string, fileIds: string[]) =>
    call<Status>("prepare_cleanup", { scanId, fileIds }),
  execute: (planId: string) => call<Status>("execute_cleanup", { planId, confirm: true }),
};
