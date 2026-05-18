import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Page through a PostgREST endpoint until the server returns a short
 * page. PostgREST's default `Max-Rows` cap is 1000 rows — a single
 * `.select()` past that threshold is silently truncated, which has
 * already cost us bugs in `shipment_registry`, `quotations`, and the
 * quotation svod.
 *
 * Pass a `buildQuery(from, to)` that returns the same builder you
 * would normally `await`, with `.range(from, to)` added. The helper
 * loops until a page comes back shorter than `pageSize` (1000).
 *
 * Usage:
 * ```ts
 * const { data, error } = await fetchAllPaginated<MyRow>((from, to) =>
 *   supabase.from("my_table").select(SELECT).eq(...).order(...).range(from, to)
 * );
 * ```
 */
export async function fetchAllPaginated<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const all: T[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}
