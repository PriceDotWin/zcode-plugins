import { describe, expect, it } from "vitest";
import { createProtection } from "#cleaner/domain/protect.ts";
import { categoryOf } from "#cleaner/domain/classify.ts";
import { createAggregator, sameFile, type FileRecord } from "#cleaner/domain/aggregate.ts";
import { page } from "#cleaner/domain/catalog.ts";

const file = (path: string, size: number, extra: Partial<FileRecord> = {}): FileRecord => ({
  path,
  name: path.split("/").pop()!,
  segments: path.split("/").slice(2, -1),
  size,
  mtimeMs: 1,
  mtimeNs: "1",
  ctimeNs: "1",
  dev: "1",
  ino: path,
  nlink: 1,
  ...extra,
});

describe("protection", () => {
  const mac = createProtection({ platform: "darwin", home: "/Users/me" });
  const win = createProtection({ platform: "win32", home: "C:\\Users\\me" });
  const linux = createProtection({ platform: "linux", home: "/home/me" });
  it("系统、凭据、版本库、回收站目录及其子路径受保护，大小写不能绕过", () => {
    for (const path of [
      "/System/Library",
      "/usr/bin/x",
      "/Users/me/Library/Caches/a",
      "/users/ME/.SSH/id",
      "/Users/me/p/.git/objects/x",
      "/Users/me/.Trash/a",
      "/Users/me/X.app/Contents/big",
    ])
      expect(mac.isProtected(path), path).toBe(true);
    for (const path of [
      "C:\\Windows\\System32",
      "c:\\program files\\app\\a.exe",
      "D:\\$Recycle.Bin\\x",
      "C:\\Users\\me\\AppData\\Roaming\\a",
      "C:\\Users\\me\\.aws\\credentials",
    ])
      expect(win.isProtected(path), path).toBe(true);
    for (const path of ["/proc/1", "/home/me/.local/share/Trash/files/a", "/home/me/.gnupg/x"])
      expect(linux.isProtected(path), path).toBe(true);
  });
  it("用户目录、外接卷与用户临时目录可分析；Linux 大小写敏感", () => {
    for (const path of [
      "/Users/me/Downloads/a.zip",
      "/Volumes/Disk/a",
      "/private/var/folders/x/T/a",
      "/",
    ])
      expect(mac.isProtected(path), path).toBe(false);
    for (const path of [
      "C:\\Users\\me\\Downloads\\a.iso",
      "D:\\Videos",
      "C:\\Users\\me\\AppData\\Local\\Temp\\a",
    ])
      expect(win.isProtected(path), path).toBe(false);
    expect(linux.isProtected("/home/me/Library/a")).toBe(false);
    expect(linux.isProtected("/home/me/App.app/a")).toBe(false);
  });
  it("macOS 应用包目录按 package 跳过", () => {
    expect(mac.skipEntry("/Users/me/X.app", "X.app", true)).toBe("package");
    expect(mac.skipEntry("/Users/me/p/.git", ".git", true)).toBe("protected");
    expect(mac.skipEntry("/Users/me/a.mov", "a.mov", false)).toBeNull();
  });
});

describe("classification and ranking", () => {
  it("按扩展名与缓存路径段分类", () => {
    expect(categoryOf("a.MOV", [])).toBe("video");
    expect(categoryOf("x.dmg", [])).toBe("installer");
    expect(categoryOf("app.log.3", [])).toBe("log");
    expect(categoryOf("a.bin", ["node_modules", "x"])).toBe("cache");
    expect(categoryOf("README", [])).toBe("other");
  });
  it("全量统计独立于排行截断；硬链接计入但标记不可清理；超长路径不进入排行", () => {
    const agg = createAggregator({
      minBytes: 10,
      parentOf: (p) => p.slice(0, p.lastIndexOf("/")),
      maxCandidates: 2,
    });
    agg.add(file("/r/a/1.mp4", 50));
    agg.add(file("/r/a/2.zip", 30, { nlink: 2 }));
    agg.add(file("/r/b/3.iso", 40));
    agg.add(file("/r/4.txt", 5));
    agg.add(file(`/r/b/${"x".repeat(1100)}.mp4`, 90));
    const snap = agg.snapshot();
    expect(snap).toMatchObject({
      scannedFiles: 5,
      scannedBytes: 215,
      candidateCount: 4,
      candidateBytes: 210,
      rankedCount: 2,
    });
    expect(snap.topLevel.map((u) => u.name)).toEqual(["b", "a", "."]);
    const ranked = agg.ranked();
    expect(ranked.map((f) => f.size)).toEqual([50, 40]);
    const all = createAggregator({ minBytes: 10, parentOf: () => "/r" });
    all.add(file("/r/a/2.zip", 30, { nlink: 2 }));
    expect(all.ranked()[0]).toMatchObject({ hardLinked: true, parent: "/r" });
  });
  it("指纹任一字段变化或变成多链接都视为不同文件", () => {
    const base = {
      dev: "1",
      ino: "18446744073709551615",
      size: 1,
      mtimeNs: "1",
      ctimeNs: "1",
      nlink: 1,
    };
    expect(sameFile(base, { ...base })).toBe(true);
    expect(sameFile(base, { ...base, ino: "18446744073709551614" })).toBe(false);
    expect(sameFile(base, { ...base, ctimeNs: "2" })).toBe(false);
    expect(sameFile(base, { ...base, nlink: 2 })).toBe(false);
  });
  it("分页有上限，搜索与类型过滤", () => {
    const agg = createAggregator({ minBytes: 1, parentOf: () => "/r" });
    for (let i = 0; i < 60; i++) agg.add(file(`/r/d/f${i}.${i % 2 ? "mp4" : "zip"}`, 100 + i));
    const files = agg.ranked();
    expect(page(files, { limit: 999 }).items).toHaveLength(20);
    expect(page(files, { category: "video" }).total).toBe(30);
    expect(page(files, { query: "F59" }).items.map((i) => i.name)).toEqual(["f59.mp4"]);
    expect(page(files, { offset: 55 }).items).toHaveLength(5);
    expect(page(files, {}).items[0]).not.toHaveProperty("fingerprint");
  });
});
