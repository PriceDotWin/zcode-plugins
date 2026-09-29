import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MiB = 1024 * 1024;
// 只在自动生成的临时目录里造文件；回收站替换为隔离目录，不触碰用户真实回收站。
const temp = await realpath(await mkdtemp(join(tmpdir(), "disk-cleaner-smoke-")));
const target = join(temp, "target");
const trash = join(temp, "trash");
await mkdir(join(target, "videos"), { recursive: true });
await writeFile(join(target, "videos", "clip.mp4"), Buffer.alloc(3 * MiB));
await writeFile(join(target, "setup.dmg"), Buffer.alloc(2 * MiB));
await writeFile(join(target, "note.txt"), "small");

const client = new Client({ name: "disk-cleaner-smoke", version: "1" });
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const ok = async (name, args) => {
  const result = await call(name, args);
  assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
  return result.structuredContent;
};
const until = async (predicate) => {
  for (let i = 0; i < 200; i++) {
    const status = await ok("get_status");
    if (predicate(status)) return status;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting for status");
};
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(root, "dist/server.mjs")],
      cwd: temp,
      env: { ...process.env, ZCODE_DISK_CLEANER_TEST_TRASH: trash },
      stderr: "pipe",
    }),
  );
  const { tools } = await client.listTools();
  const visibility = Object.fromEntries(
    tools.map((tool) => [tool.name, tool._meta?.ui?.visibility]),
  );
  assert.deepEqual(visibility.open_disk_cleaner, ["model", "app"]);
  assert.deepEqual(visibility.scan_directory, ["model", "app"]);
  for (const name of [
    "get_status",
    "list_files",
    "cancel_scan",
    "prepare_cleanup",
    "execute_cleanup",
  ])
    assert.deepEqual(visibility[name], ["app"], `${name} must be app-only`);

  const panel = await client.readResource({ uri: "ui://disk-cleaner/panel.html" });
  const html = panel.contents[0].text;
  assert.equal(panel.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.ok(html.includes('<div id="root">') && !html.includes("__PANEL_JS__"));
  assert.equal(html.match(/<\/script/gi).length, 1, "bundle must not close its script tag early");

  const protectedRoot = process.platform === "win32" ? "C:\\Windows" : "/usr";
  const denied = await call("scan_directory", { path: protectedRoot, minBytes: MiB });
  assert.equal(denied.structuredContent.error.code, "protected_path");

  const started = await ok("scan_directory", { path: target, minBytes: MiB });
  assert.match(started.scan.scanId, /^scan-/);
  const done = await until((status) => status.scan.state !== "running");
  assert.equal(done.scan.state, "done");
  assert.equal(done.scan.candidateCount, 2);
  const page = await ok("list_files", { scanId: done.scan.scanId });
  assert.deepEqual(
    page.items.map((item) => item.name),
    ["clip.mp4", "setup.dmg"],
  );

  const planned = await ok("prepare_cleanup", {
    scanId: done.scan.scanId,
    fileIds: [page.items[0].id],
  });
  const unconfirmed = await call("execute_cleanup", { planId: planned.plan.planId });
  assert.ok(unconfirmed.isError, "execute_cleanup requires confirm: true");
  await ok("execute_cleanup", { planId: planned.plan.planId, confirm: true });
  const cleaned = await until((status) => status.plan?.execution?.state === "done");
  assert.equal(cleaned.plan.execution.moved, 1);
  await assert.rejects(stat(join(target, "videos", "clip.mp4")));
  assert.equal((await readdir(trash)).length, 1);
  await ok("execute_cleanup", { planId: planned.plan.planId, confirm: true });
  assert.equal((await readdir(trash)).length, 1, "retrying a plan never moves again");
  process.stdout.write("disk cleaner smoke: ok\n");
} finally {
  await client.close();
  await rm(temp, { recursive: true, force: true });
}
