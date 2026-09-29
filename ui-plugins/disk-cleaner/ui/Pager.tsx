import { LIMITS, type ListPage } from "#cleaner/contract.ts";
import type { Strings } from "#ui/i18n.ts";

export function Pager({
  page,
  onOffset,
  t,
}: {
  page: ListPage;
  onOffset: (offset: number) => void;
  t: Strings;
}) {
  if (page.total <= LIMITS.maxPageSize) return null;
  const to = Math.min(page.total, page.offset + page.items.length);
  return (
    <div className="pager">
      <button
        type="button"
        className="button ghost"
        disabled={page.offset === 0}
        onClick={() => onOffset(Math.max(0, page.offset - LIMITS.maxPageSize))}
      >
        {t.prev}
      </button>
      <span>{t.pageOf(page.offset + 1, to, page.total)}</span>
      <button
        type="button"
        className="button ghost"
        disabled={to >= page.total}
        onClick={() => onOffset(page.offset + LIMITS.maxPageSize)}
      >
        {t.next}
      </button>
    </div>
  );
}
