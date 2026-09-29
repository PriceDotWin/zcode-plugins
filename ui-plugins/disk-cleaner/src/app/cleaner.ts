import {
  CleanerError,
  LIMITS,
  type DiskCleaner,
  type ListPage,
  type ListQuery,
  type Machine,
  type PlanSummary,
  type ScanSummary,
  type Shortcut,
  type Status,
} from "#cleaner/contract.ts";
import {
  createAggregator,
  sameFile,
  type Aggregator,
  type Fingerprint,
  type RankedFile,
} from "#cleaner/domain/aggregate.ts";
import { page, type PlanItemState } from "#cleaner/domain/catalog.ts";
import type { Protection } from "#cleaner/domain/protect.ts";

export interface WalkInput {
  root: string;
  aggregator: Aggregator;
  protection: Protection;
  signal: AbortSignal;
  deadline: number;
}
export interface Inspection extends Fingerprint {
  /** 父目录的真实路径；与扫描时不同说明祖先被替换。 */
  parentReal: string;
  isFile: boolean;
}
/** Cleaner 只经这些端口触达文件系统与系统回收站。 */
export interface CleanerPorts {
  machine: Machine;
  shortcuts: Shortcut[];
  protection: Protection;
  /** 展开 ~ 并解析为规范绝对目录；不存在或不是目录时抛 CleanerError。 */
  resolveRoot(path: string): Promise<string>;
  parentOf(path: string): string;
  walk(input: WalkInput): Promise<void>;
  volume(root: string): Promise<ScanSummary["volume"]>;
  inspect(path: string): Promise<Inspection | null>;
  trash(path: string): Promise<void>;
  now(): number;
  newId(prefix: "scan" | "plan"): string;
}

interface ScanRecord {
  summary: Omit<ScanSummary, keyof ReturnType<Aggregator["snapshot"]>>;
  aggregator: Aggregator;
  controller: AbortController;
  files: RankedFile[];
  byId: Map<string, RankedFile>;
}
interface PlanRecord {
  summary: PlanSummary;
  items: RankedFile[];
  states: Map<string, PlanItemState>;
}

export function createCleaner(ports: CleanerPorts): DiskCleaner {
  let scan: ScanRecord | null = null;
  let plan: PlanRecord | null = null;
  // 唯一的并发闸门：在任何 await 之前占用，扫描与清理互斥。
  let busy: "scan" | "cleanup" | null = null;

  const status = (): Status => ({
    machine: ports.machine,
    shortcuts: ports.shortcuts,
    scan: scan ? { ...scan.summary, ...scan.aggregator.snapshot() } : null,
    plan: plan
      ? { ...plan.summary, execution: plan.summary.execution && { ...plan.summary.execution } }
      : null,
  });
  const requireScan = (scanId: string) => {
    if (!scan || scan.summary.scanId !== scanId)
      throw new CleanerError("stale_scan", "Scan is no longer current; rescan first");
    return scan;
  };
  const ensureIdle = () => {
    if (busy)
      throw new CleanerError(
        "busy",
        busy === "scan" ? "A scan is still running" : "A cleanup is still running",
      );
  };
  const admit = (kind: "scan" | "cleanup") => {
    ensureIdle();
    busy = kind;
  };

  async function runScan(record: ScanRecord) {
    const { summary, aggregator, controller } = record;
    try {
      const [volume] = await Promise.all([
        ports.volume(summary.root).catch(() => null),
        ports.walk({
          root: summary.root,
          aggregator,
          protection: ports.protection,
          signal: controller.signal,
          deadline: ports.now() + LIMITS.maxDurationMs,
        }),
      ]);
      summary.volume = volume;
      if (summary.state === "running") {
        record.files = aggregator.ranked();
        record.byId = new Map(record.files.map((file) => [file.id, file]));
        summary.state = "done";
      }
    } catch (error) {
      if (summary.state === "running") {
        summary.state = "failed";
        summary.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      summary.partial = summary.state !== "done" || aggregator.snapshot().partialReasons.length > 0;
      summary.finishedAt = ports.now();
      busy = null;
    }
  }

  async function runCleanup(record: PlanRecord) {
    const execution = record.summary.execution!;
    try {
      for (const item of record.items) {
        const state = record.states.get(item.id)!;
        try {
          const actual = await ports.inspect(item.path);
          if (!actual) {
            Object.assign(state, { outcome: "changed", message: "missing" });
          } else if (
            !actual.isFile ||
            actual.parentReal !== item.parent ||
            ports.protection.isProtected(actual.parentReal) ||
            !sameFile(item.fingerprint, actual)
          ) {
            // 路径、祖先或文件身份与扫描时不一致：跳过，不移动任何可能已被替换的对象。
            Object.assign(state, { outcome: "changed", message: "changed since scan" });
          } else {
            await ports.trash(item.path);
            item.removed = true;
            Object.assign(state, { outcome: "moved", message: undefined });
          }
        } catch (error) {
          // 系统命令的错误输出可能很长，截断以保证分页结果大小有界。
          const message = error instanceof Error ? error.message : String(error);
          Object.assign(state, { outcome: "failed", message: message.slice(0, 300) });
        }
        if (state.outcome === "moved") {
          execution.moved += 1;
          execution.movedBytes += item.size;
        } else if (state.outcome === "changed") execution.changed += 1;
        else execution.failed += 1;
      }
    } finally {
      execution.state = "done";
      busy = null;
    }
  }

  return {
    status,
    list(query: ListQuery): ListPage {
      const current = requireScan(query.scanId);
      if (!query.planId) return page(current.files, query);
      if (!plan || plan.summary.planId !== query.planId)
        throw new CleanerError("plan_not_found", "Cleanup plan not found");
      const states = plan.states;
      return page(plan.items, query, (id) => states.get(id));
    },
    async scan({ path, minBytes }) {
      if (!Number.isSafeInteger(minBytes) || minBytes < 1)
        throw new CleanerError("invalid_input", "minBytes must be a positive integer");
      admit("scan");
      let root: string;
      try {
        root = await ports.resolveRoot(path);
        if (ports.protection.isProtected(root))
          throw new CleanerError(
            "protected_path",
            "This directory is protected and cannot be scanned",
          );
      } catch (error) {
        busy = null;
        throw error;
      }
      // 新扫描使旧计划与旧候选失效；已执行计划的结果随之丢弃，页面需以新 scanId 重新读取。
      plan = null;
      const record: ScanRecord = {
        summary: {
          scanId: ports.newId("scan"),
          root,
          minBytes,
          state: "running",
          partial: true,
          startedAt: ports.now(),
          finishedAt: null,
          volume: null,
          error: null,
        },
        aggregator: createAggregator({ minBytes, parentOf: ports.parentOf }),
        controller: new AbortController(),
        files: [],
        byId: new Map(),
      };
      scan = record;
      void runScan(record);
      return status();
    },
    cancel(scanId) {
      const current = requireScan(scanId);
      if (current.summary.state === "running") {
        current.summary.state = "cancelled";
        current.controller.abort();
      }
      return status();
    },
    prepare({ scanId, fileIds }) {
      ensureIdle();
      const current = requireScan(scanId);
      if (current.summary.state !== "done")
        throw new CleanerError(
          "scan_incomplete",
          "Only a finished scan can produce a cleanup plan",
        );
      const ids = [...new Set(fileIds)];
      if (ids.length === 0) throw new CleanerError("invalid_input", "Select at least one file");
      if (ids.length > LIMITS.maxPlanItems)
        throw new CleanerError(
          "too_many_files",
          `At most ${LIMITS.maxPlanItems} files per cleanup`,
        );
      const items = ids.map((id) => {
        const file = current.byId.get(id);
        if (!file || file.hardLinked || file.removed)
          throw new CleanerError("not_cleanable", `File ${id} cannot be cleaned`);
        return file;
      });
      plan = {
        summary: {
          planId: ports.newId("plan"),
          scanId,
          expiresAt: ports.now() + LIMITS.planTtlMs,
          count: items.length,
          totalBytes: items.reduce((sum, file) => sum + file.size, 0),
          execution: null,
        },
        items,
        states: new Map(items.map((file) => [file.id, { outcome: "pending" }])),
      };
      return status();
    },
    execute({ planId }) {
      if (!plan || plan.summary.planId !== planId)
        throw new CleanerError("plan_not_found", "Cleanup plan not found or replaced");
      // 同一 planId 重试只返回已有执行，绝不重复移动。
      if (plan.summary.execution) return status();
      if (ports.now() > plan.summary.expiresAt)
        throw new CleanerError("plan_expired", "Cleanup plan expired; prepare it again");
      if (!ports.machine.trashAvailable)
        throw new CleanerError(
          "trash_unavailable",
          "System trash is unavailable; nothing was deleted",
        );
      admit("cleanup");
      plan.summary.execution = { state: "running", moved: 0, changed: 0, failed: 0, movedBytes: 0 };
      void runCleanup(plan);
      return status();
    },
  };
}
