import { LIMITS, type FileCategory, type ScanSummary } from "#cleaner/contract.ts";
import type { Strings } from "#ui/i18n.ts";
import { cleanable, formatBytes, selectedBytes } from "#ui/model.ts";
import { Pager } from "#ui/Pager.tsx";
import type { Panel } from "#ui/usePanel.ts";

export function FileTable({
  panel,
  scan,
  locale,
  t,
}: {
  panel: Panel;
  scan: ScanSummary;
  locale: string;
  t: Strings;
}) {
  const { page, filters, selection } = panel;
  const eligible = page?.items.filter(cleanable) ?? [];
  const pageSelected = eligible.length > 0 && eligible.every((item) => selection.has(item.id));
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const categories = scan.categories.map((usage) => usage.name);
  return (
    <section className="files">
      <div className="toolbar">
        <input
          type="search"
          className="search"
          aria-label={t.search}
          placeholder={t.search}
          value={filters.query}
          onChange={(event) => panel.setFilters({ query: event.target.value })}
        />
        <select
          aria-label={t.allTypes}
          value={filters.category}
          onChange={(event) =>
            panel.setFilters({ category: event.target.value as FileCategory | "" })
          }
        >
          <option value="">{t.allTypes}</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {t.category[category]}
            </option>
          ))}
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th className="check">
              <input
                type="checkbox"
                aria-label={t.selectPage}
                checked={pageSelected}
                disabled={eligible.length === 0}
                onChange={panel.togglePage}
              />
            </th>
            <th>{t.name}</th>
            <th className="num">{t.size}</th>
            <th className="date">{t.modified}</th>
          </tr>
        </thead>
        <tbody>
          {page?.items.map((item) => {
            const disabled =
              !cleanable(item) ||
              (!selection.has(item.id) && selection.size >= LIMITS.maxPlanItems);
            const note = item.removed ? t.removed : item.hardLinked ? t.hardLinked : "";
            return (
              <tr key={item.id} className={item.removed ? "removed" : undefined} data-id={item.id}>
                <td className="check">
                  <input
                    type="checkbox"
                    aria-label={item.name}
                    checked={selection.has(item.id)}
                    disabled={disabled}
                    title={note || undefined}
                    onChange={() => panel.toggle(item)}
                  />
                </td>
                <td className="name" title={item.path}>
                  <div className="name-cell">
                    <span className="file-name">{item.name}</span>
                    <span className="file-path">{item.path}</span>
                    {note && <span className="file-note">{note}</span>}
                  </div>
                </td>
                <td className="num">{formatBytes(item.size)}</td>
                <td className="date">{date.format(item.mtimeMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {page && page.items.length === 0 && <p className="empty">{t.noResults}</p>}
      {page && <Pager page={page} t={t} onOffset={(offset) => panel.setFilters({ offset })} />}
      <div className="selection-bar">
        <span>
          {t.selected(selection.size, formatBytes(selectedBytes(selection)))}
          {selection.size >= LIMITS.maxPlanItems && (
            <span className="muted"> · {t.maxHint(LIMITS.maxPlanItems)}</span>
          )}
        </span>
        {selection.size > 0 && (
          <button type="button" className="button ghost" onClick={panel.clearSelection}>
            {t.cancel}
          </button>
        )}
        <button
          type="button"
          className="button primary"
          disabled={selection.size === 0 || panel.pending}
          onClick={() => void panel.review()}
        >
          {t.review}
        </button>
      </div>
    </section>
  );
}
