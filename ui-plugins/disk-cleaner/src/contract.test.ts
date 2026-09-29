import { describe, expect, it } from "vitest";
import { LIMITS, DEFAULT_MIN_BYTES, THRESHOLDS_MIB, type ListPage } from "#cleaner/contract.ts";
import { listExample, prepareExample } from "#cleaner/contract.example.ts";

describe("Disk cleaner contract", () => {
  it("最坏情况的一页结构化结果（Windows 反斜杠转义、255 字符文件名、错误信息）小于 64 KiB", () => {
    const path = `C:${"\\x".repeat(LIMITS.maxPathLength / 2 - 1)}`;
    const item = {
      id: "f999999999",
      path,
      name: "n".repeat(255),
      size: 2 ** 52,
      mtimeMs: 2 ** 42,
      category: "diskImage",
      topLevel: "t".repeat(255),
      hardLinked: false,
      removed: false,
      outcome: "failed",
      message: "m".repeat(300),
    } as const;
    const worst: ListPage = {
      total: 500,
      offset: 480,
      items: Array.from({ length: LIMITS.maxPageSize }, () => item),
    };
    expect(JSON.stringify(worst).length).toBeLessThan(64 * 1024);
    expect(listExample.limit).toBeLessThanOrEqual(LIMITS.maxPageSize);
    expect(prepareExample.fileIds.length).toBeLessThanOrEqual(LIMITS.maxPlanItems);
    expect(THRESHOLDS_MIB.map((m) => m * 1024 * 1024)).toContain(DEFAULT_MIN_BYTES);
  });
});
