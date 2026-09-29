import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Shortcut } from "#cleaner/contract.ts";
import { createCleaner } from "#cleaner/app/cleaner.ts";
import { createProtection } from "#cleaner/domain/protect.ts";
import { createFileSystem } from "#cleaner/adapters/fs.ts";
import { createTrash } from "#cleaner/adapters/trash.ts";
import { createDiskCleanerServer } from "#cleaner/adapters/server.ts";

const platform = process.platform;
const home = await realpath(homedir());
const exists = (path: string) =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  );
const shortcuts: Shortcut[] = [];
for (const [id, path] of [
  ["home", home],
  ["downloads", join(home, "Downloads")],
  ["desktop", join(home, "Desktop")],
] as const)
  if (await exists(path)) shortcuts.push({ id, path });
// 测试专用：注入隔离回收站目录，自动化用例不会触碰用户真实回收站。
const trash = await createTrash(platform, process.env.ZCODE_DISK_CLEANER_TEST_TRASH || undefined);
const cleaner = createCleaner({
  ...createFileSystem(home),
  machine: { hostname: hostname(), platform, trashAvailable: trash.available },
  shortcuts,
  protection: createProtection({ platform, home }),
  trash: trash.trash,
  now: Date.now,
  newId: (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`,
});
const server = createDiskCleanerServer({
  cleaner,
  assetRoot: join(dirname(fileURLToPath(import.meta.url)), "ui"),
});
let stopping = false;
async function close() {
  if (stopping) return;
  stopping = true;
  await server.close();
}
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
process.stdin.once("end", () => void close());
await server.connect(new StdioServerTransport());
