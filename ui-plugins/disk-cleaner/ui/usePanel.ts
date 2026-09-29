import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_MIN_BYTES,
  type FileCategory,
  type ListPage,
  type Status,
} from "#cleaner/contract.ts";
import { api } from "#ui/bridge.ts";
import { toggle, togglePage, type Selection } from "#ui/model.ts";

const POLL_MS = 400;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface Filters {
  query: string;
  category: FileCategory | "";
  offset: number;
}

/**
 * 面板只保存草稿（路径、阈值、筛选、选择）与服务端快照；扫描、计划、执行结果的唯一事实来源是 get_status。
 * 只在扫描或清理进行中轮询，结束即停。
 */
export function usePanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [minBytes, setMinBytes] = useState(DEFAULT_MIN_BYTES);
  const [filters, setFilters] = useState<Filters>({ query: "", category: "", offset: 0 });
  const [page, setPage] = useState<ListPage | null>(null);
  const [selection, setSelection] = useState<Selection>(new Map());
  const [reviewing, setReviewing] = useState(false);
  const [planPage, setPlanPage] = useState<ListPage | null>(null);
  const [planOffset, setPlanOffset] = useState(0);
  const [dismissedPlan, setDismissedPlan] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // 只接受最新一次 get_status 的应答，避免慢请求覆盖新状态。
  const statusSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++statusSeq.current;
    try {
      const next = await api.status();
      if (seq === statusSeq.current) setStatus(next);
    } catch (e) {
      if (seq === statusSeq.current) setError(errorText(e));
    }
  }, []);
  const accept = useCallback((next: Status) => {
    statusSeq.current += 1;
    setStatus(next);
  }, []);

  useEffect(() => {
    void refresh();
    // 模型调用 scan_directory / open_disk_cleaner 时宿主推送新结果：重新读取实时状态，不信任历史输出。
    const onGlobals = () => void refresh();
    window.addEventListener("plugin:toolresult", onGlobals);
    return () => window.removeEventListener("plugin:toolresult", onGlobals);
  }, [refresh]);

  const scan = status?.scan ?? null;
  const plan = status?.plan ?? null;
  const scanId = scan?.scanId ?? null;
  const scanDone = scan?.state === "done";
  const active = scan?.state === "running" || plan?.execution?.state === "running";

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  // 新打开的面板以当前扫描为草稿初值（含模型发起的扫描）；用户已编辑的草稿不被覆盖。
  const seededScan = useRef<string | null>(null);
  useEffect(() => {
    if (!scan || seededScan.current === scan.scanId) return;
    seededScan.current = scan.scanId;
    setPath(scan.root);
    setMinBytes(scan.minBytes);
  }, [scan]);

  // 新扫描：旧选择与筛选全部作废。
  useEffect(() => {
    setSelection(new Map());
    setFilters({ query: "", category: "", offset: 0 });
    setPage(null);
    setReviewing(false);
  }, [scanId]);

  const planKey = plan ? `${plan.planId}:${plan.execution?.state ?? "new"}` : "";
  useEffect(() => {
    if (!scanId || !scanDone) return;
    let live = true;
    const timer = setTimeout(
      () =>
        void api
          .list({
            scanId,
            offset: filters.offset,
            query: filters.query || undefined,
            category: filters.category || undefined,
          })
          .then((next) => live && setPage(next))
          .catch((e) => live && setError(errorText(e))),
      filters.query ? 200 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // 清理完成后重新拉取，拿到 removed 标记。
  }, [scanId, scanDone, filters, planKey]);

  useEffect(() => setPlanOffset(0), [plan?.planId]);
  useEffect(() => {
    if (!scanId || !plan || !(reviewing || plan.execution)) {
      setPlanPage(null);
      return;
    }
    let live = true;
    void api
      .list({ scanId, planId: plan.planId, offset: planOffset })
      .then((next) => live && setPlanPage(next))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [
    scanId,
    plan?.planId,
    reviewing,
    planOffset,
    planKey,
    plan?.execution?.moved,
    plan?.execution?.changed,
    plan?.execution?.failed,
  ]);

  const run = useCallback(
    async (action: () => Promise<Status | void>) => {
      setError(null);
      setPending(true);
      try {
        const next = await action();
        if (next) accept(next);
      } catch (e) {
        setError(errorText(e));
        void refresh();
      } finally {
        setPending(false);
      }
    },
    [accept, refresh],
  );

  return {
    status,
    error,
    pending,
    draft: { path, setPath, minBytes, setMinBytes },
    filters,
    setFilters: (patch: Partial<Filters>) =>
      setFilters((current) => ({ ...current, offset: 0, ...patch })),
    page,
    selection,
    toggle: (item: Parameters<typeof toggle>[1]) =>
      setSelection((current) => toggle(current, item)),
    togglePage: () => page && setSelection((current) => togglePage(current, page.items)),
    clearSelection: () => setSelection(new Map()),
    reviewing: reviewing && !!plan && !plan.execution,
    planPage,
    setPlanOffset,
    showResult: !!plan?.execution && plan.planId !== dismissedPlan,
    startScan: (target = path) =>
      run(async () => {
        setPath(target);
        return api.scan(target, minBytes);
      }),
    cancelScan: () => scanId && run(() => api.cancel(scanId)),
    review: () =>
      scanId &&
      run(async () => {
        const next = await api.prepare(scanId, [...selection.keys()]);
        setReviewing(true);
        return next;
      }),
    closeReview: () => setReviewing(false),
    confirm: () =>
      plan &&
      run(async () => {
        const next = await api.execute(plan.planId);
        setReviewing(false);
        setSelection(new Map());
        return next;
      }),
    dismissResult: () => plan && setDismissedPlan(plan.planId),
  };
}
export type Panel = ReturnType<typeof usePanel>;
