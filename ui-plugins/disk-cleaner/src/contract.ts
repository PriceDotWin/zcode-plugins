export const PANEL_URI = "ui://disk-cleaner/panel.html";
export const SURFACE_ID = "disk-cleaner";
export const LIMITS = {
  maxEntries: 50_000,
  maxDurationMs: 30_000,
  maxDepth: 40,
  maxCandidates: 500,
  maxPageSize: 20,
  maxPathLength: 1024,
  maxPlanItems: 100,
  planTtlMs: 5 * 60_000,
  maxTopLevel: 20,
} as const;
export const THRESHOLDS_MIB = [1, 10, 100, 1024] as const;
export const DEFAULT_MIN_BYTES = 100 * 1024 * 1024;

export type FileCategory =
  | "video"
  | "image"
  | "audio"
  | "archive"
  | "diskImage"
  | "installer"
  | "document"
  | "code"
  | "cache"
  | "log"
  | "other";
export type SkipReason = "protected" | "symlink" | "mount" | "package" | "denied" | "error";
export type PartialReason = "entryLimit" | "timeLimit" | "depthLimit" | "denied";
export type ScanState = "running" | "done" | "cancelled" | "failed";
export type Outcome = "pending" | "moved" | "changed" | "failed";

export interface Machine {
  hostname: string;
  platform: string;
  trashAvailable: boolean;
}
export interface Shortcut {
  id: "home" | "downloads" | "desktop";
  path: string;
}
export interface Candidate {
  id: string;
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
  category: FileCategory;
  /** 相对扫描根的一级目录名；根目录下的文件为 "."。 */
  topLevel: string;
  /** 硬链接计入逻辑大小，但不允许清理。 */
  hardLinked: boolean;
  /** 已被本次清理移入回收站，不能再加入计划。 */
  removed: boolean;
}
export interface Usage {
  name: string;
  bytes: number;
  files: number;
}
export interface ScanSummary {
  scanId: string;
  root: string;
  minBytes: number;
  state: ScanState;
  /** 部分扫描不代表整目录占用。 */
  partial: boolean;
  partialReasons: PartialReason[];
  startedAt: number;
  finishedAt: number | null;
  scannedFiles: number;
  scannedBytes: number;
  skipped: Partial<Record<SkipReason, number>>;
  volume: { totalBytes: number; freeBytes: number } | null;
  topLevel: Usage[];
  categories: Array<Usage & { name: FileCategory }>;
  /** 全量候选统计（不受排行截断影响）。 */
  candidateCount: number;
  candidateBytes: number;
  /** 排行保留的候选数，≤ LIMITS.maxCandidates。 */
  rankedCount: number;
  error: string | null;
}
export interface PlanSummary {
  planId: string;
  scanId: string;
  expiresAt: number;
  count: number;
  totalBytes: number;
  execution: {
    state: "running" | "done";
    moved: number;
    changed: number;
    failed: number;
    /** 逻辑大小之和；回收站未清空前不会释放。 */
    movedBytes: number;
  } | null;
}
export interface Status {
  machine: Machine;
  shortcuts: Shortcut[];
  scan: ScanSummary | null;
  plan: PlanSummary | null;
}
export interface ListQuery {
  scanId: string;
  planId?: string;
  offset?: number;
  limit?: number;
  query?: string;
  category?: FileCategory;
}
export interface ListedItem extends Candidate {
  outcome?: Outcome;
  message?: string;
}
export interface ListPage {
  total: number;
  offset: number;
  items: ListedItem[];
}

/** 扫描、候选、计划、执行结果的唯一 owner；所有调用方经此接口读写。 */
export interface DiskCleaner {
  status(): Status;
  list(query: ListQuery): ListPage;
  scan(input: { path: string; minBytes: number }): Promise<Status>;
  cancel(scanId: string): Status;
  prepare(input: { scanId: string; fileIds: string[] }): Status;
  execute(input: { planId: string }): Status;
}

export type CleanerErrorCode =
  | "invalid_input"
  | "not_found"
  | "not_directory"
  | "protected_path"
  | "busy"
  | "stale_scan"
  | "scan_incomplete"
  | "plan_expired"
  | "plan_not_found"
  | "not_cleanable"
  | "too_many_files"
  | "trash_unavailable";
export class CleanerError extends Error {
  readonly code: CleanerErrorCode;
  constructor(code: CleanerErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "CleanerError";
  }
}
