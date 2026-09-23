/**
 * Знаки после запятой в выгрузках.
 *
 * Канон клиента 2026-09-22 (Telegram): «для котировки, цены и тоннажа
 * оставить 3 знака после запятой, а всем суммам кроме цен и объёма
 * поставить 2». До этого (2026-09-08) три знака стояли у всех денег.
 *
 * Почему у ставок три знака, а не два: клиент проверяет файл, перемножая
 * «цена × объём» тем числом, которое видит в ячейке. Цена отгрузки в базе
 * округлена ровно до трёх знаков (00166), поэтому ставку нельзя печатать
 * короче — иначе сумма в файле снова перестанет сходиться с его Excel.
 *
 * Тест держит числовые форматы всех выгрузок и НЕ ДАЁТ появиться
 * неклассифицированной числовой колонке: новая колонка обязана попасть
 * либо в ставки/объёмы (3 знака), либо в суммы (2). Экранные хелперы
 * форматирования лежат по одному на поверхность и тестами не покрыты —
 * здесь закреплена та часть, которая уходит клиенту файлом.
 */
import { describe, it, expect } from "vitest";
import { PASSPORT_COLUMNS } from "@/lib/exports/passport-excel";
import { DETAIL_COLUMNS } from "@/lib/exports/passport-detail-excel";
import { DTKT_SHORT_COLUMNS, DTKT_DETAIL_COLUMNS } from "@/lib/exports/dtkt-excel";
import { REGISTRY_PTS_COLUMNS, REGISTRY_FULL_COLUMNS } from "@/lib/exports/registry-excel";

type NumFmtCol = { key: string; numFmt?: string };

const surfaces: [string, readonly NumFmtCol[]][] = [
  ["паспорт краткий", PASSPORT_COLUMNS as unknown as NumFmtCol[]],
  ["паспорт детальный", DETAIL_COLUMNS as unknown as NumFmtCol[]],
  ["ДТ-КТ краткий", DTKT_SHORT_COLUMNS as unknown as NumFmtCol[]],
  ["ДТ-КТ детальный", DTKT_DETAIL_COLUMNS as unknown as NumFmtCol[]],
  ["реестр ПТС", REGISTRY_PTS_COLUMNS as unknown as NumFmtCol[]],
  ["реестр полный", REGISTRY_FULL_COLUMNS as unknown as NumFmtCol[]],
];

/** Ставка за единицу: цена $/т, тариф, котировка, скидка, курс, коэффициент. */
const RATE = /price|tariff|quotation|discount|ratio|rate/;
/** Объём в тоннах. */
const VOLUME = /volume|tonnage|remainder|remaining/;
/** Сумма денег. */
const SUM = /amount|payment|offset|balance|debt|refund|saldo|opening|fines|surcharge|ogem|expenses/;

function expectedDecimals(key: string): 2 | 3 | null {
  if (RATE.test(key) || VOLUME.test(key)) return 3;
  if (SUM.test(key)) return 2;
  return null;
}

describe.each(surfaces)("%s: знаки после запятой", (_name, cols) => {
  // «#,##0.00;[Red]-#,##0.00» → все дробные части маски.
  const fractions = (numFmt: string) =>
    [...numFmt.matchAll(/0\.(0+)/g)].map((m) => m[1].length);

  const numeric = cols.filter((c) => c.numFmt && /0\.0/.test(c.numFmt));

  it("в выгрузке есть числовые колонки", () => {
    expect(numeric.length).toBeGreaterThan(0);
  });

  it("каждая числовая колонка классифицирована как ставка, объём или сумма", () => {
    const unknownKeys = numeric.filter((c) => expectedDecimals(c.key) === null).map((c) => c.key);
    expect(unknownKeys).toEqual([]);
  });

  it.each(numeric.map((c) => [c.key, c.numFmt as string]))(
    "%s — %s",
    (key, numFmt) => {
      const want = expectedDecimals(key as string);
      if (want === null) return; // уже поймано проверкой выше
      for (const digits of fractions(numFmt)) expect(digits).toBe(want);
    },
  );
});

describe("канон: суммы — 2 знака, ставки и объём — 3", () => {
  it("сумма отгрузки печатается с двумя знаками", () => {
    const col = (DETAIL_COLUMNS as unknown as NumFmtCol[]).find((c) => c.key === "buyer_shipped_amount");
    expect(col?.numFmt).toBe("#,##0.00;[Red]-#,##0.00");
  });

  it("цена и котировка остаются с тремя", () => {
    const cols = DETAIL_COLUMNS as unknown as NumFmtCol[];
    expect(cols.find((c) => c.key === "buyer_price")?.numFmt).toBe("#,##0.000");
    expect(cols.find((c) => c.key === "buyer_quotation")?.numFmt).toBe("#,##0.000");
  });

  it("тариф логистов в реестре остаётся с тремя, сумма — с двумя", () => {
    const cols = REGISTRY_FULL_COLUMNS as unknown as NumFmtCol[];
    expect(cols.find((c) => c.key === "railway_tariff")?.numFmt).toBe("#,##0.000");
    expect(cols.find((c) => c.key === "rounded_tonnage")?.numFmt).toBe("#,##0.000");
    expect(cols.find((c) => c.key === "shipped_amount")?.numFmt).toBe("#,##0.00");
  });
});
