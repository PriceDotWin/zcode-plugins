import type { ScanSummary, SkipReason, Usage } from "#cleaner/contract.ts";
import type { Strings } from "#ui/i18n.ts";
import { formatBytes, share } from "#ui/model.ts";

function Bars({
  title,
  rows,
  total,
  label,
}: {
  title: string;
  rows: Usage[];
  total: number;
  label: (name: string) => string;
}) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((row) => row.bytes), 1);
  return (
    <section className="bars" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {rows.slice(0, 8).map((row) => (
          <li
            key={row.name}
            title={`${label(row.name)} · ${formatBytes(row.bytes)} · ${row.files} · ${Math.round(share(row.bytes, total) * 100)}%`}
          >
            <span className="bar-label">{label(row.name)}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${Math.max(1, share(row.bytes, max) * 100)}%` }}
              />
            </span>
            <span className="bar-value">{formatBytes(row.bytes)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Overview({
  scan,
  platform,
  t,
}: {
  scan: ScanSummary;
  platform: string;
  t: Strings;
}) {
  const volume = scan.volume;
  const used = volume ? volume.totalBytes - volume.freeBytes : 0;
  const skipped = Object.entries(scan.skipped).filter(([, n]) => n) as Array<[SkipReason, number]>;
  const denied = scan.partialReasons.includes("denied");
  const hint =
    platform === "darwin" || platform === "win32" ? t.deniedHint[platform] : t.deniedHint.other;
  return (
    <div className="overview">
      <div className="stats">
        {volume && (
          <div className="stat wide">
            <span className="stat-label">{t.volume}</span>
            <span
              className="meter"
              role="img"
              aria-label={`${formatBytes(used)} / ${formatBytes(volume.totalBytes)}`}
            >
              <span
                className="meter-fill"
                style={{ width: `${share(used, volume.totalBytes) * 100}%` }}
              />
            </span>
            <span className="stat-sub">
              {formatBytes(volume.freeBytes)} {t.free} / {formatBytes(volume.totalBytes)}
            </span>
          </div>
        )}
        <div className="stat">
          <span className="stat-label">{t.scanned}</span>
          <span className="stat-value">{formatBytes(scan.scannedBytes)}</span>
          <span className="stat-sub">
            {scan.scannedFiles.toLocaleString()} {t.files}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">{t.candidates}</span>
          <span className="stat-value">{formatBytes(scan.candidateBytes)}</span>
          <span className="stat-sub">
            {scan.candidateCount.toLocaleString()} {t.files}
          </span>
        </div>
      </div>
      {scan.state === "done" && scan.partial && (
        <div className="notice warning" role="status">
          <strong>{t.partial}</strong>
          <span>{scan.partialReasons.map((reason) => t.partialReason[reason]).join(" · ")}</span>
          {denied && <span>{hint}</span>}
        </div>
      )}
      {skipped.length > 0 && (
        <p className="skipped">
          {t.skipped}: {skipped.map(([reason, n]) => `${t.skip[reason]} ${n}`).join(" · ")}
        </p>
      )}
      <div className="breakdown">
        <Bars
          title={t.byFolder}
          rows={scan.topLevel}
          total={scan.scannedBytes}
          label={(name) => (name === "." ? t.root : name)}
        />
        <Bars
          title={t.byType}
          rows={scan.categories}
          total={scan.scannedBytes}
          label={(name) => t.category[name as keyof Strings["category"]] ?? name}
        />
      </div>
    </div>
  );
}
