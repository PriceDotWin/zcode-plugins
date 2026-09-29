import { describe, expect, it } from "vitest";
import { LIMITS, type Candidate } from "#cleaner/contract.ts";
import { formatBytes, selectedBytes, share, toggle, togglePage } from "#ui/model.ts";

const item = (i: number, extra: Partial<Candidate> = {}): Candidate => ({
  id: `f${i}`,
  path: `/r/${i}`,
  name: String(i),
  size: 10,
  mtimeMs: 0,
  category: "other",
  topLevel: ".",
  hardLinked: false,
  removed: false,
  ...extra,
});

describe("panel model", () => {
  it("字节格式化", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(150 * 1024 ** 3)).toBe("150 GB");
  });
  it("硬链接与已移除文件不可选；选择有上限；整页切换", () => {
    let s = toggle(new Map(), item(1, { hardLinked: true }));
    expect(s.size).toBe(0);
    s = toggle(s, item(2, { removed: true }));
    expect(s.size).toBe(0);
    const page = Array.from({ length: 20 }, (_, i) => item(i));
    s = togglePage(new Map(), page);
    expect(s.size).toBe(20);
    expect(selectedBytes(s)).toBe(200);
    expect(togglePage(s, page).size).toBe(0);
    let many: ReturnType<typeof toggle> = new Map();
    for (let i = 0; i < LIMITS.maxPlanItems + 5; i++) many = toggle(many, item(i));
    expect(many.size).toBe(LIMITS.maxPlanItems);
    expect(toggle(many, item(0)).size).toBe(LIMITS.maxPlanItems - 1);
  });
  it("占比夹在 0..1", () => {
    expect(share(5, 0)).toBe(0);
    expect(share(20, 10)).toBe(1);
  });
});
