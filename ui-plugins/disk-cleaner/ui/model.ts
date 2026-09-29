import { LIMITS, type Candidate } from "#cleaner/contract.ts";

const UNITS = ["B", "KB", "MB", "GB", "TB"];
/** 二进制单位，与阈值（MiB）一致；显示用 KB/MB，符合系统文件管理器的习惯。 */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

export interface Selected {
  size: number;
  path: string;
}
export type Selection = ReadonlyMap<string, Selected>;
export const cleanable = (item: Pick<Candidate, "hardLinked" | "removed">) =>
  !item.hardLinked && !item.removed;

/** 选择只属于当前 scanId；上限与可清理规则和 prepare_cleanup 一致，服务端仍会再次校验。 */
export function toggle(selection: Selection, item: Candidate): Selection {
  const next = new Map(selection);
  if (next.has(item.id)) next.delete(item.id);
  else if (cleanable(item) && next.size < LIMITS.maxPlanItems)
    next.set(item.id, { size: item.size, path: item.path });
  return next;
}
export function togglePage(selection: Selection, items: readonly Candidate[]): Selection {
  const eligible = items.filter(cleanable);
  const next = new Map(selection);
  if (eligible.length > 0 && eligible.every((item) => next.has(item.id))) {
    for (const item of eligible) next.delete(item.id);
    return next;
  }
  for (const item of eligible) {
    if (next.size >= LIMITS.maxPlanItems) break;
    next.set(item.id, { size: item.size, path: item.path });
  }
  return next;
}
export const selectedBytes = (selection: Selection) =>
  [...selection.values()].reduce((sum, item) => sum + item.size, 0);
export const share = (part: number, whole: number) =>
  whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0;
