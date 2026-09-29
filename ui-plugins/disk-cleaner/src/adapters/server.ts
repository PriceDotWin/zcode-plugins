import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CleanerError,
  DEFAULT_MIN_BYTES,
  LIMITS,
  PANEL_URI,
  SURFACE_ID,
  type DiskCleaner,
  type Status,
} from "#cleaner/contract.ts";

const HTML_MIME = "text/html;profile=mcp-app";
const CATEGORIES = [
  "video",
  "image",
  "audio",
  "archive",
  "diskImage",
  "installer",
  "document",
  "code",
  "cache",
  "log",
  "other",
] as const;

/** 给模型的简短文字；完整数据只在 structuredContent，供面板读取。 */
function describe(status: Status): string {
  const scan = status.scan;
  const where = `${status.machine.hostname} (${status.machine.platform})`;
  if (!scan) return `Disk cleaner panel opened on ${where}. No scan yet.`;
  return `Scan ${scan.state} for ${scan.root} on ${where}: ${scan.scannedFiles} files, ${scan.candidateCount} files ≥ ${scan.minBytes} bytes. Results and cleanup are in the Disk Cleaner panel; files are only moved to the trash after the user confirms there.`;
}

export function createDiskCleanerServer({
  cleaner,
  assetRoot,
}: {
  cleaner: DiskCleaner;
  assetRoot: string;
}) {
  const server = new McpServer({ name: "disk-cleaner", version: "0.1.1" });
  const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
  const register = (
    name: string,
    description: string,
    inputSchema: Record<string, z.ZodType>,
    visibility: "model" | "app",
    execute: (input: any) => Promise<Record<string, unknown>> | Record<string, unknown>,
  ) => {
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        _meta: {
          ui: {
            resourceUri: PANEL_URI,
            surface: SURFACE_ID,
            // 清理相关工具只给面板：模型只能打开面板与发起只读扫描。
            visibility: visibility === "model" ? ["model", "app"] : ["app"],
          },
          ...(visibility === "model"
            ? { "openai/ui": { preferredModelDisplayMode: "fullscreen" } }
            : {}),
        },
      },
      async (input) => {
        try {
          const result = await execute(input);
          const text = "machine" in result ? describe(result as unknown as Status) : "OK";
          return { content: [{ type: "text" as const, text }], structuredContent: result };
        } catch (error) {
          const code = error instanceof CleanerError ? error.code : "operation_failed";
          const message = error instanceof Error ? error.message : String(error);
          return {
            isError: true,
            content: [{ type: "text" as const, text: `[${code}] ${message}` }],
            structuredContent: { error: { code, message } },
          };
        }
      },
    );
  };
  register(
    "open_disk_cleaner",
    "Open the Disk Cleaner panel, where the user can analyze a directory's usage and large files and move selected files to the system trash.",
    {},
    "model",
    () => ({ ...cleaner.status() }),
  );
  register(
    "scan_directory",
    "Start a read-only metadata scan of a directory (absolute path or ~, ~/Downloads, ~/Desktop) and show results in the Disk Cleaner panel. Never deletes anything; cleanup requires the user's confirmation in the panel.",
    {
      path: z.string().min(1).max(4096),
      minBytes: z
        .number()
        .int()
        .min(1024 * 1024)
        .max(1024 ** 4)
        .default(DEFAULT_MIN_BYTES),
    },
    "model",
    async (input) => ({ ...(await cleaner.scan(input)) }),
  );
  register("get_status", "Current scan, plan and cleanup result.", {}, "app", () => ({
    ...cleaner.status(),
  }));
  register(
    "list_files",
    "Page ranked large files of the current scan, or the items of a cleanup plan with outcomes.",
    {
      scanId: id,
      planId: id.optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(LIMITS.maxPageSize).default(LIMITS.maxPageSize),
      query: z.string().max(200).optional(),
      category: z.enum(CATEGORIES).optional(),
    },
    "app",
    (input) => ({ ...cleaner.list(input) }),
  );
  register("cancel_scan", "Cancel the running scan.", { scanId: id }, "app", (input) => ({
    ...cleaner.cancel(input.scanId),
  }));
  register(
    "prepare_cleanup",
    "Create a cleanup plan for selected files of a finished scan.",
    {
      scanId: id,
      fileIds: z
        .array(z.string().regex(/^f\d{1,9}$/))
        .min(1)
        .max(LIMITS.maxPlanItems),
    },
    "app",
    (input) => ({ ...cleaner.prepare(input) }),
  );
  register(
    "execute_cleanup",
    "Move the files of a confirmed plan to the system trash.",
    { planId: id, confirm: z.literal(true) },
    "app",
    (input) => ({ ...cleaner.execute({ planId: input.planId }) }),
  );
  server.registerResource("panel", PANEL_URI, { mimeType: HTML_MIME }, async () => ({
    contents: [
      {
        uri: PANEL_URI,
        mimeType: HTML_MIME,
        text: await readFile(join(assetRoot, "panel.html"), "utf8"),
      },
    ],
  }));
  return server;
}
