import {
  LIMITS,
  type FileCategory,
  type ListedItem,
  type ListPage,
  type Outcome,
} from "#cleaner/contract.ts";
import type { RankedFile } from "#cleaner/domain/aggregate.ts";

export interface PlanItemState {
  outcome: Outcome;
  message?: string;
}

/** 候选的对外投影：去掉指纹与父目录，只带页面需要的字段。 */
export function publicItem(file: RankedFile, state?: PlanItemState): ListedItem {
  const { fingerprint: _fingerprint, parent: _parent, ...item } = file;
  return state
    ? { ...item, outcome: state.outcome, ...(state.message ? { message: state.message } : {}) }
    : item;
}

/** 搜索（名称/路径，大小写不敏感）、类型过滤与有界分页。 */
export function page(
  files: readonly RankedFile[],
  input: { offset?: number; limit?: number; query?: string; category?: FileCategory },
  stateOf?: (id: string) => PlanItemState | undefined,
): ListPage {
  const query = input.query?.trim().toLowerCase();
  const matched = files.filter(
    (file) =>
      (!input.category || file.category === input.category) &&
      (!query || file.path.toLowerCase().includes(query)),
  );
  const limit = Math.max(1, Math.min(input.limit ?? LIMITS.maxPageSize, LIMITS.maxPageSize));
  const offset = Math.max(0, Math.min(input.offset ?? 0, Math.max(0, matched.length - 1)));
  return {
    total: matched.length,
    offset,
    items: matched
      .slice(offset, offset + limit)
      .map((file) => publicItem(file, stateOf?.(file.id))),
  };
}
