import { useEffect, useRef } from "react";
import type { Machine, PlanSummary } from "#cleaner/contract.ts";
import type { Strings } from "#ui/i18n.ts";
import { formatBytes } from "#ui/model.ts";
import { Pager } from "#ui/Pager.tsx";
import type { Panel } from "#ui/usePanel.ts";

/** 计划确认与执行结果共用一个对话框：执行前列出完整路径，执行后逐项显示结果。 */
export function PlanDialog({
  panel,
  plan,
  machine,
  t,
}: {
  panel: Panel;
  plan: PlanSummary;
  machine: Machine;
  t: Strings;
}) {
  const execution = plan.execution;
  const dialog = useRef<HTMLDivElement>(null);
  const close = execution ? panel.dismissResult : panel.closeReview;
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && execution?.state !== "running") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, execution?.state]);
  return (
    <div className="backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-title"
        ref={dialog}
      >
        <h2 id="plan-title">{execution ? t.resultTitle : t.planTitle}</h2>
        {!execution && (
          <>
            <p>{t.planBody(plan.count, formatBytes(plan.totalBytes))}</p>
            <p className="muted">{t.planNote}</p>
            {!machine.trashAvailable && <div className="notice danger">{t.trashUnavailable}</div>}
          </>
        )}
        {execution?.state === "running" && (
          <p role="status">
            {t.running} {execution.moved + execution.changed + execution.failed} / {plan.count}
          </p>
        )}
        {execution?.state === "done" && (
          <p role="status">
            {t.resultBody(execution.moved, formatBytes(execution.movedBytes))}
            {execution.changed > 0 && ` ${t.outcome.changed} ${execution.changed}.`}
            {execution.failed > 0 && ` ${t.outcome.failed} ${execution.failed}.`}
          </p>
        )}
        <ul className="plan-list">
          {panel.planPage?.items.map((item) => (
            <li key={item.id} data-outcome={item.outcome}>
              <span className="plan-path" title={item.path}>
                {item.path}
              </span>
              <span className="plan-size">{formatBytes(item.size)}</span>
              {execution && (
                <span className={`outcome ${item.outcome}`} title={item.message}>
                  {t.outcome[item.outcome ?? "pending"]}
                </span>
              )}
            </li>
          ))}
        </ul>
        {panel.planPage && <Pager page={panel.planPage} t={t} onOffset={panel.setPlanOffset} />}
        <div className="dialog-actions">
          {!execution && (
            <>
              <button type="button" className="button" onClick={panel.closeReview}>
                {t.cancel}
              </button>
              <button
                type="button"
                className="button danger"
                disabled={panel.pending || !machine.trashAvailable}
                onClick={() => void panel.confirm()}
              >
                {t.planConfirm}
              </button>
            </>
          )}
          {execution?.state === "done" && (
            <button type="button" className="button primary" onClick={panel.dismissResult}>
              {t.close}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
