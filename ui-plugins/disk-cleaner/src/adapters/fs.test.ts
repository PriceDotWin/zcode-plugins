import { afterEach, describe, expect, it } from "vitest";
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCleaner } from "#cleaner/app/cleaner.ts";
import { createProtection } from "#cleaner/domain/protect.ts";
import { createFileSystem } from "#cleaner/adapters/fs.ts";
import { createTrash } from "#cleaner/adapters/trash.ts";

const MiB = 1024 * 1024;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** 只在自动生成的临时目录里造文件，回收站替换为隔离目录。 */
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "zcode-disk-cleaner-")));
  roots.push(base);
  const root = join(base, "scan");
  const trashDir = join(base, "trash");
  await mkdir(join(root, "media", "nested"), { recursive: true });
  await mkdir(join(root, "repo", ".git"), { recursive: true });
  await writeFile(join(root, "media", "a.mp4"), Buffer.alloc(3 * MiB));
  await writeFile(join(root, "media", "nested", "b.zip"), Buffer.alloc(2 * MiB));
  await writeFile(join(root, "repo", ".git", "pack.bin"), Buffer.alloc(4 * MiB));
  await writeFile(join(root, "hard.iso"), Buffer.alloc(2 * MiB));
  await link(join(root, "hard.iso"), join(base, "hard-copy.iso"));
  await writeFile(join(root, "small.txt"), "x");
  const symlinked = await symlink(join(root, "media", "a.mp4"), join(root, "alias.mp4")).then(
    () => true,
    () => false,
  );
  const trash = await createTrash(process.platform, trashDir);
  const cleaner = createCleaner({
    ...createFileSystem(base),
    machine: { hostname: "test", platform: process.platform, trashAvailable: trash.available },
    shortcuts: [],
    protection: createProtection({ platform: process.platform, home: base }),
    trash: trash.trash,
    now: Date.now,
    newId: (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`,
  });
  return { base, root, trashDir, cleaner, symlinked };
}

async function scanned(t: Awaited<ReturnType<typeof fixture>>) {
  const scanId = (await t.cleaner.scan({ path: t.root, minBytes: MiB })).scan!.scanId;
  for (let i = 0; i < 200 && t.cleaner.status().scan!.state === "running"; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  const items = t.cleaner.list({ scanId }).items;
  const idOf = (name: string) => items.find((item) => item.name === name)!.id;
  return { scanId, items, idOf };
}
async function execute(t: Awaited<ReturnType<typeof fixture>>, scanId: string, fileIds: string[]) {
  const planId = t.cleaner.prepare({ scanId, fileIds }).plan!.planId;
  t.cleaner.execute({ planId });
  for (let i = 0; i < 200 && t.cleaner.status().plan!.execution!.state === "running"; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  return t.cleaner.list({ scanId, planId }).items;
}

describe("file system adapter", () => {
  it("不跟随符号链接、不进入 .git，硬链接标记为不可清理", async () => {
    const t = await fixture();
    const { items } = await scanned(t);
    expect(items.map((item) => item.name).sort()).toEqual(["a.mp4", "b.zip", "hard.iso"]);
    expect(items.find((item) => item.name === "hard.iso")!.hardLinked).toBe(true);
    const scan = t.cleaner.status().scan!;
    expect(scan).toMatchObject({ state: "done", partial: false, candidateCount: 3 });
    expect(scan.skipped.protected).toBe(1);
    if (t.symlinked) expect(scan.skipped.symlink).toBe(1);
    expect(scan.topLevel.map((usage) => usage.name)).toEqual(["media", "."]);
  });

  it("~ 展开、相对路径与文件路径被拒绝", async () => {
    const fs = createFileSystem("/nonexistent-home");
    await expect(fs.resolveRoot("relative/dir")).rejects.toMatchObject({ code: "invalid_input" });
    const t = await fixture();
    await expect(createFileSystem(t.base).resolveRoot("~/scan")).resolves.toBe(t.root);
    await expect(
      createFileSystem(t.base).resolveRoot(join(t.root, "small.txt")),
    ).rejects.toMatchObject({
      code: "not_directory",
    });
  });

  it("未变化的文件移入隔离回收站；替换过的文件与被换掉的祖先目录跳过", async () => {
    const t = await fixture();
    const { scanId, idOf } = await scanned(t);
    // 文件被同名同大小的新文件替换：身份不同。
    await rm(join(t.root, "media", "nested", "b.zip"));
    await writeFile(join(t.root, "media", "nested", "b.zip"), Buffer.alloc(2 * MiB));
    const results = await execute(t, scanId, [idOf("a.mp4"), idOf("b.zip")]);
    expect(results.map((item) => [item.name, item.outcome])).toEqual([
      ["a.mp4", "moved"],
      ["b.zip", "changed"],
    ]);
    expect(await readdir(t.trashDir)).toHaveLength(1);
  });

  it("祖先目录被换成指向同一文件的链接时不移动", async () => {
    const t = await fixture();
    const { scanId, idOf } = await scanned(t);
    const moved = join(t.base, "moved-media");
    await rename(join(t.root, "media"), moved);
    // junction 让 Windows 无需管理员权限；POSIX 忽略该类型参数。
    const linked = await symlink(moved, join(t.root, "media"), "junction").then(
      () => true,
      () => false,
    );
    if (!linked) return;
    const results = await execute(t, scanId, [idOf("a.mp4")]);
    expect(results[0]!.outcome).toBe("changed");
    expect(await readdir(join(moved))).toContain("a.mp4");
  });
});
