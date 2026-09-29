import {
  LIMITS,
  type Candidate,
  type FileCategory,
  type PartialReason,
  type ScanSummary,
  type SkipReason,
  type Usage,
} from "#cleaner/contract.ts";
import { categoryOf } from "#cleaner/domain/classify.ts";

/**
 * 文件身份指纹。dev/ino/时间取自 bigint stat 并以十进制字符串保存：
 * NTFS 文件 ID 为 64 位，转成 number 会丢精度，导致 Windows 上不同文件被误判为同一文件。
 */
export interface Fingerprint {
  dev: string;
  ino: string;
  size: number;
  mtimeNs: string;
  ctimeNs: string;
  nlink: number;
}
export interface FileRecord extends Fingerprint {
  path: string;
  name: string;
  mtimeMs: number;
  /** 扫描根下的目录段（不含文件名），首段即一级目录。 */
  segments: readonly string[];
}
/** owner 内部保留的候选：对外 Candidate 之外还有执行复核所需的指纹与父目录。 */
export interface RankedFile extends Candidate {
  fingerprint: Fingerprint;
  parent: string;
}
export type AggregateSnapshot = Pick<
  ScanSummary,
  | "scannedFiles"
  | "scannedBytes"
  | "skipped"
  | "partialReasons"
  | "topLevel"
  | "categories"
  | "candidateCount"
  | "candidateBytes"
  | "rankedCount"
>;

/** 未变化且仍为单链接才允许移动；任一字段变化都视为不同文件。 */
export function sameFile(expected: Fingerprint, actual: Fingerprint): boolean {
  return (
    actual.nlink === 1 &&
    actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    actual.size === expected.size &&
    actual.mtimeNs === expected.mtimeNs &&
    actual.ctimeNs === expected.ctimeNs
  );
}

const bySize = (a: { size: number; path: string }, b: { size: number; path: string }) =>
  b.size - a.size || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const usageList = <T extends string>(map: Map<T, Usage>, limit: number) =>
  [...map.values()]
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
    .slice(0, limit);

/** 纯累加器：全量统计 + 有界排行（保留前 maxCandidates 个 ≥ minBytes 的文件）。 */
export function createAggregator({
  minBytes,
  parentOf,
  maxCandidates = LIMITS.maxCandidates,
}: {
  minBytes: number;
  parentOf: (path: string) => string;
  maxCandidates?: number;
}) {
  let scannedFiles = 0;
  let scannedBytes = 0;
  let candidateCount = 0;
  let candidateBytes = 0;
  let nextId = 1;
  const skipped: Partial<Record<SkipReason, number>> = {};
  const partialReasons = new Set<PartialReason>();
  const topLevel = new Map<string, Usage>();
  const categories = new Map<FileCategory, Usage & { name: FileCategory }>();
  let ranked: RankedFile[] = [];
  const bump = <K extends string>(map: Map<K, Usage>, name: K, size: number) => {
    const usage = map.get(name) ?? { name, bytes: 0, files: 0 };
    usage.bytes += size;
    usage.files += 1;
    map.set(name, usage);
  };
  const compact = () => {
    ranked.sort(bySize);
    ranked = ranked.slice(0, maxCandidates);
  };
  return {
    add(file: FileRecord) {
      scannedFiles += 1;
      scannedBytes += file.size;
      const category = categoryOf(file.name, file.segments);
      const top = file.segments[0] ?? ".";
      bump(topLevel, top, file.size);
      bump(categories as Map<FileCategory, Usage>, category, file.size);
      if (file.size < minBytes) return;
      candidateCount += 1;
      candidateBytes += file.size;
      // 超长路径计入全量统计，但不进入排行，保证分页结果大小有界。
      if (file.path.length > LIMITS.maxPathLength) return;
      const { dev, ino, size, mtimeMs, mtimeNs, ctimeNs, nlink } = file;
      ranked.push({
        id: `f${nextId++}`,
        path: file.path,
        name: file.name,
        size,
        mtimeMs,
        category,
        topLevel: top,
        hardLinked: nlink > 1,
        removed: false,
        fingerprint: { dev, ino, size, mtimeNs, ctimeNs, nlink },
        parent: parentOf(file.path),
      });
      if (ranked.length >= maxCandidates * 2) compact();
    },
    skip(reason: SkipReason) {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
    },
    partial(reason: PartialReason) {
      partialReasons.add(reason);
    },
    snapshot(): AggregateSnapshot {
      return {
        scannedFiles,
        scannedBytes,
        skipped: { ...skipped },
        partialReasons: [...partialReasons],
        topLevel: usageList(topLevel, LIMITS.maxTopLevel),
        categories: usageList(categories, 20) as ScanSummary["categories"],
        candidateCount,
        candidateBytes,
        rankedCount: Math.min(ranked.length, maxCandidates),
      };
    },
    ranked(): RankedFile[] {
      compact();
      return ranked;
    },
  };
}
export type Aggregator = ReturnType<typeof createAggregator>;
