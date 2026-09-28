export const PAGE_SIZE = 50;
// Far past any real deck, and small enough that the range() offset stays exact.
export const MAX_PAGE = 100_000;

// Anything that is not an integer in 1..MAX_PAGE means the first page.
export function parsePage(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw)) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1;
}

export interface PageWindow {
  // inclusive bounds for supabase-js range()
  from: number;
  to: number;
  lastPage: number;
  hasNewer: boolean;
  hasOlder: boolean;
}

// Page 1 holds the newest cards, so "newer" is the lower page number.
export function pageWindow(page: number, total: number): PageWindow {
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = (page - 1) * PAGE_SIZE;
  return {
    from,
    to: from + PAGE_SIZE - 1,
    lastPage,
    hasNewer: page > 1,
    hasOlder: page < lastPage,
  };
}
