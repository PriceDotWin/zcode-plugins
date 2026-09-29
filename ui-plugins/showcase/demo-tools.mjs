import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import cases from "./cases.json" with { type: "json" };
import { CASES_URI, DASHBOARD_URI } from "./resources.mjs";

export function registerDemoTools(server) {
  server.registerTool(
    "show_cases",
    {
      description:
        "Open the complete Showcase case directory and interactive lab. Covers legacy demonstrations, sampling, cancellation, retention, storage and explicit unsupported boundaries. Use this first when asked to demonstrate all plugin capabilities.",
      inputSchema: { caseId: z.enum(cases.map((item) => item.id)).optional() },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: CASES_URI, visibility: ["model", "app"], prefersBorder: true } },
    },
    async ({ caseId }) => ({
      content: [
        {
          type: "text",
          text: "Showcase: 53 documented cases, including 2 explicitly pending capabilities. Open the directory to select a demonstration.",
        },
      ],
      structuredContent: {
        kind: "cases",
        version: "0.4.2",
        total: cases.length,
        caseId: caseId ?? "SC01",
      },
      _meta: { "openai/widgetSessionId": "showcase-cases" },
    }),
  );

  server.registerTool(
    "cancellable_check",
    {
      description:
        "Read-only cancellable demo check. Waits up to ten seconds; never writes service data.",
      inputSchema: { durationMs: z.number().int().min(1).max(10_000).default(10_000) },
      annotations: { readOnlyHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ durationMs }, extra) => {
      await server.server.sendLoggingMessage({
        level: "info",
        logger: "showcase",
        data: { event: "check-started" },
      });
      // 真实传播 MCP 取消；只读延时模拟工作，不用另一个计时器伪造成功或重放。
      await delay(durationMs, undefined, { signal: extra.signal });
      return {
        content: [{ type: "text", text: "Read-only check completed." }],
        structuredContent: { kind: "check", completed: true },
      };
    },
  );

  for (const mode of ["inline", "fullscreen", "pinned"]) {
    const name = mode === "inline" ? "show_failure" : `show_failure_${mode}`;
    server.registerTool(
      name,
      {
        description: `Demo an intentional ${mode} UI tool failure. Only use for an explicitly requested failure demonstration; the host must not open or replace a successful App.`,
        inputSchema: { throwError: z.boolean().optional() },
        annotations: { readOnlyHint: true },
        _meta: {
          ui: {
            resourceUri: DASHBOARD_URI,
            visibility: ["model", "app"],
            ...(mode === "pinned" ? { showInline: true } : {}),
          },
          ...(mode === "fullscreen"
            ? { "openai/ui": { preferredModelDisplayMode: "fullscreen" } }
            : {}),
        },
      },
      async ({ throwError }) => {
        if (throwError) throw new Error(`Intentional Showcase ${mode} exception`);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Intentional Showcase ${mode} error; keep the previous successful view.`,
            },
          ],
          _meta: { "openai/widgetSessionId": "showcase-dashboard" },
        };
      },
    );
  }
}
