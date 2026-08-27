/**
 * Постраничное вычитывание таблицы Supabase.
 *
 * PostgREST режет ответ на `max-rows` (у нас 1000) НЕЗАВИСИМО от `.limit()`:
 * проверено на проде 27.08.2026 — `.limit(5000)` вернул ровно 1000 строк,
 * и в выборе встречной сделки взаимозачёта оказались только сделки 2026
 * года, а всё, что ниже по коду, молча пропало.
 *
 * Шагаем ровно на столько строк, сколько отдал сервер, и останавливаемся
 * на первой ПУСТОЙ странице. Так цикл не зависит от того, чему равен
 * max-rows: неполная страница может означать и конец данных, и упор в
 * лимит, а пустая — только конец данных.
 */
export const SUPABASE_PAGE_SIZE = 1000;

/** Предохранитель на случай, если сервер начнёт отдавать одну и ту же страницу. */
export const SUPABASE_MAX_ROWS = 50_000;

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize: number = SUPABASE_PAGE_SIZE,
  maxRows: number = SUPABASE_MAX_ROWS,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (rows.length < maxRows) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.length === 0) break;
    rows.push(...page);
    from += page.length;
  }
  return rows;
}
