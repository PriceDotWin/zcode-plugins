import { THRESHOLDS_MIB } from "#cleaner/contract.ts";
import type { Strings } from "#ui/i18n.ts";
import { formatBytes } from "#ui/model.ts";
import type { Panel } from "#ui/usePanel.ts";

const presets: number[] = THRESHOLDS_MIB.map((mib) => mib * 1024 * 1024);

export function ScanForm({ panel, t }: { panel: Panel; t: Strings }) {
  const { status, draft, pending } = panel;
  const running = status?.scan?.state === "running";
  const cleaning = status?.plan?.execution?.state === "running";
  return (
    <form
      className="scan-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!running) void panel.startScan();
      }}
    >
      <div className="field grow">
        <label htmlFor="scan-path">{t.path}</label>
        <input
          id="scan-path"
          value={draft.path}
          placeholder={t.pathPlaceholder}
          spellCheck={false}
          autoComplete="off"
          disabled={running}
          onChange={(event) => draft.setPath(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="scan-threshold">{t.threshold}</label>
        <select
          id="scan-threshold"
          value={draft.minBytes}
          disabled={running}
          onChange={(event) => draft.setMinBytes(Number(event.target.value))}
        >
          {/* 模型可用任意阈值发起扫描：不在预设里时补一个选项，避免显示与实际不符。 */}
          {!presets.includes(draft.minBytes) && (
            <option value={draft.minBytes}>{formatBytes(draft.minBytes)}</option>
          )}
          {THRESHOLDS_MIB.map((mib) => (
            <option key={mib} value={mib * 1024 * 1024}>
              {mib >= 1024 ? `${mib / 1024} GB` : `${mib} MB`}
            </option>
          ))}
        </select>
      </div>
      {running ? (
        <button type="button" className="button" onClick={() => void panel.cancelScan()}>
          {t.cancel}
        </button>
      ) : (
        <button
          type="submit"
          className="button primary"
          disabled={pending || cleaning || !draft.path.trim()}
        >
          {status?.scan ? t.rescan : t.scan}
        </button>
      )}
      {status && status.shortcuts.length > 0 && (
        <div className="shortcuts">
          {status.shortcuts.map((shortcut) => (
            <button
              key={shortcut.id}
              type="button"
              className="chip"
              title={shortcut.path}
              disabled={running || cleaning || pending}
              onClick={() => void panel.startScan(shortcut.path)}
            >
              {t.shortcut[shortcut.id]}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
