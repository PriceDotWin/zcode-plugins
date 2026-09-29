import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { strings } from "#ui/i18n.ts";
import { usePanel } from "#ui/usePanel.ts";
import { host } from "#ui/bridge.ts";
import { ScanForm } from "#ui/ScanForm.tsx";
import { Overview } from "#ui/Overview.tsx";
import { FileTable } from "#ui/FileTable.tsx";
import { PlanDialog } from "#ui/PlanDialog.tsx";
import "#ui/panel.css";
import "#ui/table.css";

const PLATFORM: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

/** 宿主主题：标准样式变量写到 :root，缺省时由 panel.css 的 fallback 生效。 */
function useHostGlobals() {
  const read = () => ({
    theme: host.context?.theme ?? "light",
    locale: host.context?.locale ?? navigator.language,
  });
  const [globals, setGlobals] = useState(read);
  useLayoutEffect(() => {
    const apply = () => {
      const next = read();
      setGlobals(next);
      const root = document.documentElement;
      root.dataset.theme = next.theme;
      root.lang = next.locale;
      const variables = host.context?.styles?.variables ?? {};
      for (const [key, value] of Object.entries(variables))
        if (typeof value === "string") root.style.setProperty(key, value);
    };
    apply();
    window.addEventListener("plugin:hostchange", apply);
    return () => window.removeEventListener("plugin:hostchange", apply);
  }, []);
  return globals;
}

function App() {
  const { locale } = useHostGlobals();
  const t = strings(locale);
  const panel = usePanel();
  const container = useRef<HTMLElement>(null);
  const { status, error } = panel;
  const scan = status?.scan ?? null;
  const plan = status?.plan ?? null;

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      host.notifyIntrinsicHeight(Math.ceil(node.scrollHeight)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="panel" ref={container}>
      <header className="panel-header">
        <h1>{t.title}</h1>
        {status && (
          <span className="machine" title={status.machine.hostname}>
            {status.machine.hostname} ·{" "}
            {PLATFORM[status.machine.platform] ?? status.machine.platform}
          </span>
        )}
      </header>
      <ScanForm panel={panel} t={t} />
      {status && !status.machine.trashAvailable && (
        <div className="notice">{t.trashUnavailable}</div>
      )}
      {error && (
        <div className="notice danger" role="alert">
          {error}
        </div>
      )}
      {!scan && status && <p className="empty">{t.empty}</p>}
      {scan?.state === "running" && (
        <div className="progress" role="status">
          <span className="spinner" aria-hidden="true" />
          {t.scanning} {scan.scannedFiles.toLocaleString()} {t.files}
        </div>
      )}
      {scan?.state === "cancelled" && <p className="notice">{t.cancelled}</p>}
      {scan?.state === "failed" && (
        <div className="notice danger" role="alert">
          {t.failed}: {scan.error}
        </div>
      )}
      {scan && scan.state !== "cancelled" && scan.state !== "failed" && (
        <p className="root-path" title={scan.root}>
          {scan.root}
        </p>
      )}
      {scan && (scan.state === "running" || scan.state === "done") && (
        <Overview scan={scan} platform={status!.machine.platform} t={t} />
      )}
      {scan?.state === "done" && <FileTable panel={panel} scan={scan} locale={locale} t={t} />}
      {plan && (panel.reviewing || panel.showResult) && (
        <PlanDialog panel={panel} plan={plan} machine={status!.machine} t={t} />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
