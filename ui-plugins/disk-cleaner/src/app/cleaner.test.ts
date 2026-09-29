import { describe, expect, it } from "vitest";
import { CleanerError, LIMITS } from "#cleaner/contract.ts";
import {
  createCleaner,
  type CleanerPorts,
  type Inspection,
  type WalkInput,
} from "#cleaner/app/cleaner.ts";
import { createProtection } from "#cleaner/domain/protect.ts";

const fp = (size: number) => ({
  dev: "1",
  ino: String(size),
  size,
  mtimeNs: "1",
  ctimeNs: "1",
  nlink: 1,
});
function setup(overrides: Partial<CleanerPorts> = {}) {
  let clock = 1000;
  let ids = 0;
  let release: () => void = () => {};
  const trashed: string[] = [];
  const disk = new Map<string, Inspection>();
  const files = [
    { path: "/r/a/big.mp4", size: 300 },
    { path: "/r/b/mid.zip", size: 200 },
    { path: "/r/b/link.iso", size: 150, nlink: 2 },
    { path: "/r/small.txt", size: 1 },
  ];
  for (const f of files)
    disk.set(f.path, {
      ...fp(f.size),
      nlink: f.nlink ?? 1,
      parentReal: f.path.slice(0, f.path.lastIndexOf("/")),
      isFile: true,
    });
  const ports: CleanerPorts = {
    machine: { hostname: "test-host", platform: "darwin", trashAvailable: true },
    shortcuts: [],
    protection: createProtection({ platform: "darwin", home: "/Users/me" }),
    resolveRoot: async (path) => {
      if (path === "/missing") throw new CleanerError("not_found", "missing");
      return path;
    },
    parentOf: (p) => p.slice(0, p.lastIndexOf("/")),
    walk: async ({ aggregator, signal }: WalkInput) => {
      await new Promise<void>((resolve) => {
        release = resolve;
        signal.addEventListener("abort", () => resolve());
      });
      if (signal.aborted) return;
      for (const f of files) {
        const segments = f.path.split("/").slice(2, -1);
        aggregator.add({
          path: f.path,
          name: f.path.split("/").pop()!,
          segments,
          mtimeMs: 1,
          ...fp(f.size),
          nlink: f.nlink ?? 1,
        });
      }
    },
    volume: async () => ({ totalBytes: 1000, freeBytes: 100 }),
    inspect: async (path) => disk.get(path) ?? null,
    trash: async (path) => {
      trashed.push(path);
      disk.delete(path);
    },
    now: () => clock,
    newId: (prefix) => `${prefix}-${++ids}`,
    ...overrides,
  };
  const cleaner = createCleaner(ports);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    cleaner,
    disk,
    trashed,
    settle,
    finishWalk: async () => {
      release();
      await settle();
    },
    advance: (ms: number) => (clock += ms),
  };
}
const idOf = (c: ReturnType<typeof setup>["cleaner"], scanId: string, name: string) =>
  c.list({ scanId }).items.find((i) => i.name === name)!.id;

describe("Cleaner owner", () => {
  it("扫描互斥，完成后给出统计与排行，受保护与不存在的根被拒绝且不占用 busy", async () => {
    const t = setup();
    await expect(t.cleaner.scan({ path: "/r", minBytes: 0 })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(t.cleaner.scan({ path: "/Users/me/.ssh", minBytes: 100 })).rejects.toMatchObject({
      code: "protected_path",
    });
    await expect(t.cleaner.scan({ path: "/missing", minBytes: 100 })).rejects.toMatchObject({
      code: "not_found",
    });
    const started = await t.cleaner.scan({ path: "/r", minBytes: 100 });
    expect(started.scan).toMatchObject({ state: "running", partial: true });
    await expect(t.cleaner.scan({ path: "/r", minBytes: 100 })).rejects.toMatchObject({
      code: "busy",
    });
    const scanId = started.scan!.scanId;
    expect(() => t.cleaner.prepare({ scanId, fileIds: ["f1"] })).toThrow(/still running/);
    await t.finishWalk();
    const done = t.cleaner.status().scan!;
    expect(done).toMatchObject({
      state: "done",
      partial: false,
      candidateCount: 3,
      rankedCount: 3,
      volume: { totalBytes: 1000 },
    });
    expect(t.cleaner.list({ scanId }).items.map((i) => i.size)).toEqual([300, 200, 150]);
  });

  it("取消的扫描不能生成计划；旧 scanId 被拒绝", async () => {
    const t = setup();
    const scanId = (await t.cleaner.scan({ path: "/r", minBytes: 100 })).scan!.scanId;
    expect(t.cleaner.cancel(scanId).scan!.state).toBe("cancelled");
    await t.settle();
    expect(() => t.cleaner.prepare({ scanId, fileIds: ["f1"] })).toThrow(/finished scan/);
    await t.cleaner.scan({ path: "/r", minBytes: 100 });
    expect(() => t.cleaner.list({ scanId })).toThrow(CleanerError);
  });

  it("计划校验上限、硬链接与过期；同 planId 重试不重复移动；新扫描使计划失效", async () => {
    const t = setup();
    const scanId = (await t.cleaner.scan({ path: "/r", minBytes: 100 })).scan!.scanId;
    await t.finishWalk();
    const big = idOf(t.cleaner, scanId, "big.mp4");
    expect(() =>
      t.cleaner.prepare({ scanId, fileIds: [idOf(t.cleaner, scanId, "link.iso")] }),
    ).toThrow(/cannot be cleaned/);
    expect(() =>
      t.cleaner.prepare({
        scanId,
        fileIds: Array.from({ length: LIMITS.maxPlanItems + 1 }, (_, i) => `f${i}`),
      }),
    ).toThrow(/At most/);
    const expired = t.cleaner.prepare({ scanId, fileIds: [big] }).plan!;
    t.advance(LIMITS.planTtlMs + 1);
    expect(() => t.cleaner.execute({ planId: expired.planId })).toThrow(/expired/);
    const plan = t.cleaner.prepare({
      scanId,
      fileIds: [big, big, idOf(t.cleaner, scanId, "mid.zip")],
    }).plan!;
    expect(plan).toMatchObject({ count: 2, totalBytes: 500, execution: null });
    expect(() => t.cleaner.execute({ planId: expired.planId })).toThrow(/not found/);
    t.cleaner.execute({ planId: plan.planId });
    expect(t.cleaner.execute({ planId: plan.planId }).plan!.execution!.state).toBe("running");
    await expect(t.cleaner.scan({ path: "/r", minBytes: 100 })).rejects.toMatchObject({
      code: "busy",
    });
    await t.settle();
    await t.settle();
    const result = t.cleaner.execute({ planId: plan.planId }).plan!.execution!;
    expect(result).toMatchObject({ state: "done", moved: 2, movedBytes: 500 });
    expect(t.trashed).toEqual(["/r/a/big.mp4", "/r/b/mid.zip"]);
    expect(t.cleaner.list({ scanId, planId: plan.planId }).items.map((i) => i.outcome)).toEqual([
      "moved",
      "moved",
    ]);
    expect(() => t.cleaner.prepare({ scanId, fileIds: [big] })).toThrow(/cannot be cleaned/);
    await t.cleaner.scan({ path: "/r", minBytes: 100 });
    expect(t.cleaner.status().plan).toBeNull();
  });

  it("文件、祖先或身份变化时跳过，回收站错误逐项报告", async () => {
    const t = setup({
      trash: async (path) => {
        throw new Error(`denied ${path}`);
      },
    });
    const scanId = (await t.cleaner.scan({ path: "/r", minBytes: 100 })).scan!.scanId;
    await t.finishWalk();
    const [big, mid] = ["big.mp4", "mid.zip"].map((n) => idOf(t.cleaner, scanId, n));
    t.disk.set("/r/a/big.mp4", { ...t.disk.get("/r/a/big.mp4")!, parentReal: "/elsewhere" });
    const plan = t.cleaner.prepare({ scanId, fileIds: [big!, mid!] }).plan!;
    t.cleaner.execute({ planId: plan.planId });
    await t.settle();
    await t.settle();
    const items = t.cleaner.list({ scanId, planId: plan.planId }).items;
    expect(items.map((i) => i.outcome)).toEqual(["changed", "failed"]);
    expect(items[1]!.message).toContain("denied");
    expect(t.cleaner.status().plan!.execution).toMatchObject({ changed: 1, failed: 1, moved: 0 });
  });

  it("回收站不可用时只分析，拒绝执行", async () => {
    const t = setup({ machine: { hostname: "h", platform: "freebsd", trashAvailable: false } });
    const scanId = (await t.cleaner.scan({ path: "/r", minBytes: 100 })).scan!.scanId;
    await t.finishWalk();
    const plan = t.cleaner.prepare({ scanId, fileIds: [idOf(t.cleaner, scanId, "big.mp4")] }).plan!;
    expect(() => t.cleaner.execute({ planId: plan.planId })).toThrow(/unavailable/);
  });
});
