import { describe, it, expect } from "vitest";
import { fetchAllPages, SUPABASE_PAGE_SIZE } from "@/lib/supabase/paginate";

/**
 * Регрессия к находке на проде 27.08.2026: PostgREST режет ответ на
 * max-rows независимо от `.limit()`. Запрос `.limit(5000)` вернул ровно
 * 1000 строк, и в выборе встречной сделки взаимозачёта остались только
 * сделки 2026 года — всё, что ниже по коду, молча пропало.
 */

/** Сервер с жёстким потолком строк на ответ, как у PostgREST. */
function fakeServer(total: number, maxRows: number) {
  const все = Array.from({ length: total }, (_, i) => `row-${i}`);
  const запросы: Array<[number, number]> = [];
  return {
    запросы,
    fetchPage: async (from: number, to: number) => {
      запросы.push([from, to]);
      const конец = Math.min(to + 1, from + maxRows, total);
      return все.slice(from, Math.max(from, конец));
    },
  };
}

describe("fetchAllPages", () => {
  it("норма: страниц меньше потолка — забирает всё за один проход плюс пустая страница", async () => {
    const s = fakeServer(250, 1000);
    const rows = await fetchAllPages(s.fetchPage);
    expect(rows).toHaveLength(250);
    expect(s.запросы).toHaveLength(2); // 250 строк, затем пустая страница
  });

  it("сервер режет на max-rows: всё равно вычитывает всё", async () => {
    // Ровно тот случай, что был на проде: просим 1000, но строк 2350.
    const s = fakeServer(2350, 1000);
    const rows = await fetchAllPages(s.fetchPage);
    expect(rows).toHaveLength(2350);
    expect(new Set(rows).size).toBe(2350); // без дублей
    expect(rows[0]).toBe("row-0");
    expect(rows[2349]).toBe("row-2349");
  });

  it("max-rows МЕНЬШЕ размера страницы — шагаем по факту, а не по запрошенному", async () => {
    // Неполная страница не значит «данные кончились»: обрыв на 400 строк
    // при запросе 1000 раньше приводил бы к молчаливой потере хвоста.
    const s = fakeServer(1000, 400);
    const rows = await fetchAllPages(s.fetchPage);
    expect(rows).toHaveLength(1000);
  });

  it("граница: ровно одна полная страница", async () => {
    const s = fakeServer(SUPABASE_PAGE_SIZE, 1000);
    const rows = await fetchAllPages(s.fetchPage);
    expect(rows).toHaveLength(SUPABASE_PAGE_SIZE);
  });

  it("граница: пустая таблица — один запрос, пустой результат", async () => {
    const s = fakeServer(0, 1000);
    expect(await fetchAllPages(s.fetchPage)).toEqual([]);
    expect(s.запросы).toHaveLength(1);
  });

  it("предохранитель: сервер зациклился — цикл всё равно кончается", async () => {
    let вызовов = 0;
    const rows = await fetchAllPages(async () => { вызовов++; return ["всегда одно и то же"]; }, 10, 25);
    expect(rows).toHaveLength(25);
    expect(вызовов).toBe(25);
  });

  it("ошибка страницы пробрасывается наружу", async () => {
    await expect(
      fetchAllPages(async () => { throw new Error("сеть отвалилась"); }),
    ).rejects.toThrow("сеть отвалилась");
  });
});
