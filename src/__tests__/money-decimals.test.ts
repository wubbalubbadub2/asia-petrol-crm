/**
 * Три знака после запятой в деньгах.
 *
 * Клиент 2026-09-08 (WhatsApp): «Сделай три знака после запятой везде» —
 * во всех числах, связанных с ценой (деньгами), в сделках, реестре,
 * ДТ-КТ и выгрузках из них. До этого с тремя знаками шли только объём и
 * цена за тонну (клиент 2026-09-04), а суммы, оплаты, сальдо, тарифы,
 * котировки и скидки — с двумя.
 *
 * Тест держит числовые форматы выгрузок: любая числовая колонка
 * паспорта (краткого и детального), реестра и ДТ-КТ печатает ровно три
 * знака. Колонки дат (dd.mm.yy) сюда не попадают — у них нет дробной
 * части в маске.
 *
 * Счета-фактуры под правило не подпадают и остаются с 2 знаками —
 * это закреплено в format-price.test.ts на formatMoney.
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

// «#,##0.000;[Red]-#,##0.000» → длины всех дробных частей маски.
const fractions = (numFmt: string) =>
  [...numFmt.matchAll(/0\.(0+)/g)].map((m) => m[1].length);

describe.each(surfaces)("%s: числовые колонки — 3 знака", (_name, cols) => {
  const numeric = cols.filter((c) => c.numFmt && /0\.0/.test(c.numFmt));

  it("в выгрузке есть числовые колонки", () => {
    expect(numeric.length).toBeGreaterThan(0);
  });

  it.each(numeric.map((c) => [c.key, c.numFmt as string]))("%s — %s", (_key, numFmt) => {
    for (const digits of fractions(numFmt)) expect(digits).toBe(3);
  });
});
