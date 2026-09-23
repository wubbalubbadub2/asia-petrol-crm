/**
 * Постраничное чтение обязано иметь ПОЛНЫЙ порядок строк.
 *
 * Клиент 2026-09-17: «ДТ-КТ логистика при выгрузке в эксель неправильно
 * формулу считает». Причина оказалась не в формуле: `.range()` PostgREST
 * превращает в LIMIT/OFFSET, и без уникального ключа в сортировке
 * страницы «плывут» — одна строка читается дважды, другая пропадает.
 * Проверено на Postgres 15 (2500 строк, одна правка между страницами):
 *   без ORDER BY      → 1 потеряна, 1 задвоена;
 *   ORDER BY date     → 3 потеряно, 3 задвоено;
 *   ORDER BY date, id → 0 потерь.
 * Для денег это значит разъезд экрана с Excel и обоих — с реестром.
 *
 * Тест сканирует исходники: у каждой цепочки с `.range()` последний
 * ключ сортировки обязан быть уникальным. Исключения — только явные,
 * с причиной (вью без `id`, где уникальна пара колонок).
 *
 * Тот же инвариант уже проверяется в рантайме для `fetchDealEvents`
 * (`src/lib/data/deal-events.ts`) — здесь он распространён на весь код.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

/**
 * Комментарии из скана убираются: `.range()` в тексте комментария — не
 * запрос. Грубого удаления `//` и блочных комментариев здесь достаточно:
 * ложное срабатывание на строковом литерале с «//» безопаснее, чем
 * пропущенный запрос.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !full.includes("__tests__") ? [full] : [];
  });
}

/** Колонки, уникальные сами по себе. */
const UNIQUE_LAST_KEY = new Set(["id"]);

/**
 * Явные исключения: файл → последний ключ сортировки, который уникален
 * в паре с предыдущими. У вью и табличных функций своего `id` нет.
 */
const ALLOWED: Record<string, { key: string; why: string }[]> = {
  "lib/exports/passport-detail-excel.ts": [
    { key: "side", why: "deal_payment_terms — вью; (shipment_id, side) уникальна" },
  ],
  "lib/hooks/use-payment-dates-summary.ts": [
    { key: "side", why: "deal_payment_dates_summary — вью; (deal_id, side) уникальна" },
  ],
  "lib/hooks/use-payment-terms-summary.ts": [
    { key: "side", why: "deal_payment_terms_summary — вью; (deal_id, side) уникальна" },
  ],
  "lib/exports/passport-as-of.ts": [
    { key: "deal_id", why: "passport_snapshot_as_of отдаёт по строке на сделку" },
  ],
  "lib/hooks/use-fiscal-documents.ts": [
    { key: "counterparty_identifier", why: "fiscal_counterparty — одна строка на контрагента" },
  ],
  "lib/hooks/use-payment-terms.ts": [
    { key: "side", why: "deal_payment_terms_report — вью; (deal_id, side) уникальна" },
  ],
  "lib/hooks/use-deals.ts": [
    { key: "", why: "цепочка собирается в baseFilter() — она заканчивается .order(\"id\"), см. соседний запрос" },
  ],
  "lib/data/deal-events.ts": [
    { key: "", why: "общий хелпер: требование «последний ключ — id» проверяется в рантайме в самом файле" },
    { key: "quote_currency", why: "fx_rates: (date, base_currency, quote_currency) уникальна" },
  ],
  // Отчёты FX читают табличные функции, у которых своего уникального
  // ключа в выдаче нет (fx_report_price — строка на отгрузку). Это
  // экранный отчёт, в выгрузки он не входит; лечится только правкой
  // сигнатуры функции — вынесено отдельной задачей.
  "lib/hooks/use-fx-reports.ts": [
    { key: "", why: "RPC fx_report_* — уникального ключа в выдаче нет, отчёт только на экране" },
  ],
};

type Chain = { file: string; keys: string[]; snippet: string };

function chains(): Chain[] {
  const out: Chain[] = [];
  for (const file of walk(SRC)) {
    const text = stripComments(readFileSync(file, "utf8"));
    const rel = file.slice(SRC.length + 1);
    let idx = text.indexOf(".range(");
    while (idx !== -1) {
      const head = text.lastIndexOf(".from(", idx);
      const rpc = text.lastIndexOf(".rpc(", idx);
      const start = Math.max(head, rpc);
      // Начала цепочки не видно (пример в комментарии, обёртка-хелпер) —
      // такие места проверяются по месту вызова.
      if (start !== -1 && idx - start < 2000) {
        const snippet = text.slice(start, idx);
        const keys = [...snippet.matchAll(/\.order\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
        out.push({ file: rel, keys, snippet });
      }
      idx = text.indexOf(".range(", idx + 1);
    }
  }
  return out;
}

const found = chains();

describe("страницы .range() читаются детерминированно", () => {
  it("сканер нашёл постраничные запросы", () => {
    expect(found.length).toBeGreaterThan(8);
  });

  it.each(found.map((c, i) => [`${c.file} #${i}`, c] as const))("%s", (_name, chain) => {
    const allowed = ALLOWED[chain.file] ?? [];
    const last = chain.keys[chain.keys.length - 1] ?? "";
    const ok = UNIQUE_LAST_KEY.has(last) || allowed.some((a) => a.key === last);
    expect(
      ok,
      `последний ключ сортировки «${last || "(сортировки нет)"}» не уникален — ` +
      `страницы LIMIT/OFFSET потеряют и задвоят строки. Добавьте .order("id") ` +
      `или внесите исключение с причиной в ALLOWED.`,
    ).toBe(true);
  });
});
