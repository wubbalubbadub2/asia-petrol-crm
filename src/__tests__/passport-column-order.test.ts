/**
 * Порядок колонок паспорта: описание vs разметка.
 *
 * Зачем этот тест. В passport-table.tsx порядок колонок задан ТРИЖДЫ:
 *   1. PT_UNITS_ORDER — из него выводятся номера колонок, на которых
 *      держатся CSS-правила скрытия и закрепления;
 *   2. <th> в шапке;
 *   3. <td> в строке данных и в строке «Итого».
 * Ничто в компиляторе не связывает их между собой.
 *
 * 2026-08-12 они разошлись: в PT_UNITS_ORDER шло «Тариф менеджер →
 * Сумма ЖД», а ячейки рендерились наоборот, и суммы ЖД встали под
 * заголовком тарифа. Сборка прошла, тесты прошли, ошибку нашёл клиент.
 * Проверка «столько же ячеек, сколько заголовков» её не поймала —
 * количество совпадало.
 *
 * Поэтому тест сверяет ПОСЛЕДОВАТЕЛЬНОСТЬ, а не количество, и держит
 * ожидаемый порядок явным списком: перестановка колонки обязана быть
 * осознанной правкой этого файла, а не побочным эффектом.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(process.cwd(), "src/components/deals/passport-table.tsx"),
  "utf8",
);

// ── Ожидаемый порядок ───────────────────────────────────────────────
// Ключи PT_UNITS_ORDER сверху вниз. Клиент 2026-08-15: Сумма 1
// (invoice_amount) — у логистов; суммы 2 и 3 — у поставщика.
const EXPECTED_KEYS = [
  "month", "factory", "fuel", "sulfur",
  "supplier", "supplier_contract", "supplier_basis", "supplier_volume",
  "supplier_amount", "supplier_price", "supplier_shipped_amount",
  "supplier_shipped_volume", "supplier_payment", "supplier_payment_date",
  "supplier_offset", "supplier_railway_amount", "additional_expenses",
  // ВТД — номера документов с отгрузок (00169). Клиент 2026-09-23:
  // «между столбцами Взаимозачет и Баланс».
  "supplier_vtd",
  "supplier_balance",
  "groups",
  "buyer", "buyer_contract", "buyer_basis", "buyer_volume", "buyer_amount",
  "buyer_price", "buyer_ordered", "buyer_remainder", "buyer_shipped_volume",
  "buyer_shipped_amount", "buyer_payment", "buyer_payment_date",
  "buyer_offset", "buyer_debt",
  "forwarder", "logistics_group", "planned_tariff", "preliminary_tonnage",
  "preliminary_amount", "actual_tariff", "actual_volume", "invoice_amount",
  "shipper_tariff", "manager",
  "pay_terms_sup", "pay_days_sup", "pay_terms_buy", "pay_days_buy",
  // Закупка (только KG) — в конце паспорта (клиент 2026-10-07).
  "upstream_seller", "upstream_appendix", "upstream_volume",
  // Оплаты первичному поставщику (00181, клиент 2026-10-07).
  "upstream_paid", "upstream_paid_date",
];

// Заголовки <th> в том же порядке. Расходятся с label в PT_UNITS_ORDER
// там, где шапка короче ради ширины колонки, — это нормально; важно,
// что расхождения зафиксированы здесь и видны при правке.
const EXPECTED_HEADERS = [
  "Месяц", "Завод", "ГСМ", "%S",
  "Поставщик", "Номер приложения", "Базис", "Объем", "Сумма дог.", "Цена",
  "Приход, сумма", "Приход, тонн", "Оплата", "Дата оплаты", "Взаимозачет",
  "Сумма ЖД (поставщик)", "Сумма грузоотправления", "ВТД", "Баланс",
  "Компания", "Цена гр.",
  "Покупатель", "Номер приложения", "Базис", "Объем", "Сумма дог.", "Цена",
  "Заявлено", "Остаток", "Отгр. тонн", "Отгр. сумма", "Оплата",
  "Дата оплаты", "Взаимозачет", "Долг",
  "Экспедитор", "Группа комп.", "Тариф", "Объем план", "Предв. сумма",
  "Тариф факт", "Факт объем", "Сумма (логисты)", "Тариф грузоотправления",
  "Коммерция",
  "Условия (Пост.)", "Дней (Пост.)", "Условия (Покуп.)", "Дней (Покуп.)",
  "Первичный поставщик", "Номер приложения", "Объём выкупа",
  "Сумма оплаты", "Дата оплаты",
];

// ── Разбор файла ────────────────────────────────────────────────────

function parseUnitKeys(): string[] {
  const start = SRC.indexOf("const PT_UNITS_ORDER: PtUnitDef[] = [");
  expect(start, "PT_UNITS_ORDER не найден").toBeGreaterThan(-1);
  const end = SRC.indexOf("\n];", start);
  const block = SRC.slice(start, end);
  return [...block.matchAll(/\{\s*key:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Заголовки колонок. Ячейки шапки помечены `sticky top-7`; первая
 * («№») многострочная, последняя — пустая колонка удаления. Обе
 * выпадают из однострочного шаблона, поэтому список получается ровно
 * из колонок между ними.
 */
function parseHeaders(): string[] {
  return [...SRC.matchAll(/<th className="sticky top-7[^"]*"(?:\s+title="[^"]*")?>([^<>{}]+)<\/th>/g)]
    .map((m) => m[1].trim())
    .filter((s) => s.length > 0);
}

describe("паспорт: порядок колонок", () => {
  it("PT_UNITS_ORDER идёт в ожидаемом порядке", () => {
    expect(parseUnitKeys()).toEqual(EXPECTED_KEYS);
  });

  it("заголовки шапки идут в ожидаемом порядке", () => {
    expect(parseHeaders()).toEqual(EXPECTED_HEADERS);
  });

  it("шапка и PT_UNITS_ORDER описывают одинаковое число колонок", () => {
    // «Группы компании» — одна запись на два заголовка (hSpan: 2).
    expect(parseHeaders().length).toBe(parseUnitKeys().length + 1);
  });

  it("денежные колонки стоят на своих местах в обоих списках", () => {
    // Именно здесь всё разъехалось в прошлый раз: суммы и тарифы
    // соседствуют, перепутать их местами легко, а на экране это
    // выглядит как правдоподобное число не в своей колонке.
    const keys = parseUnitKeys();
    const headers = parseHeaders();
    const groupsAt = keys.indexOf("groups");
    const headerFor = (key: string) => {
      const i = keys.indexOf(key);
      expect(i, `колонка ${key} потерялась`).toBeGreaterThan(-1);
      // После «Групп компании» нумерация заголовков уезжает на 1.
      return headers[i > groupsAt ? i + 1 : i];
    };

    expect(headerFor("supplier_railway_amount")).toBe("Сумма ЖД (поставщик)");
    expect(headerFor("additional_expenses")).toBe("Сумма грузоотправления");
    expect(headerFor("supplier_balance")).toBe("Баланс");
    expect(headerFor("invoice_amount")).toBe("Сумма (логисты)");
    expect(headerFor("shipper_tariff")).toBe("Тариф грузоотправления");
    expect(headerFor("actual_tariff")).toBe("Тариф факт");
  });

  it("Сумма 1 у логистов, суммы 2 и 3 у поставщика", () => {
    // Клиент 2026-08-15: «Сумма 1 - это раздел логистов, сумма 2,3
    // менеджер, должны быть отображены со стороны поставщика».
    const start = SRC.indexOf("const PT_UNITS_ORDER: PtUnitDef[] = [");
    const block = SRC.slice(start, SRC.indexOf("\n];", start));
    const bandOf = (key: string) => {
      const m = block.match(
        new RegExp(`\\{\\s*key:\\s*"${key}",\\s*label:\\s*"[^"]*",\\s*band:\\s*"([a-z]+)"`),
      );
      return m?.[1];
    };
    expect(bandOf("invoice_amount")).toBe("logistics");
    expect(bandOf("supplier_railway_amount")).toBe("supplier");
    expect(bandOf("additional_expenses")).toBe("supplier");
  });

  it("Закупка — свой бэнд в конце паспорта и только в паспорте KG", () => {
    const start = SRC.indexOf("const PT_UNITS_ORDER: PtUnitDef[] = [");
    const block = SRC.slice(start, SRC.indexOf("\n];", start));
    for (const key of ["upstream_seller", "upstream_appendix", "upstream_volume", "upstream_paid", "upstream_paid_date"]) {
      expect(block).toMatch(new RegExp(`key:\\s*"${key}",[^}]*band:\\s*"upstream"`));
    }
    const keys = parseUnitKeys();
    // Клиент 2026-10-07: «перенеси в конец паспорта».
    expect(keys.slice(-5)).toEqual(["upstream_seller", "upstream_appendix", "upstream_volume", "upstream_paid", "upstream_paid_date"]);
    // В KZ и «Всех сделках» колонки прячутся принудительно.
    expect(SRC).toContain('const KG_ONLY_COLS = ["upstream_seller", "upstream_appendix", "upstream_volume", "upstream_paid", "upstream_paid_date"]');
    // Клиент 2026-10-05: «Закупка» свёрнута по умолчанию, раскрывается кнопкой.
    expect(SRC).toContain('useUserPref<boolean>("passport_upstream_open", false)');
    expect(SRC).toMatch(/dealType !== "KG" \|\| !upstreamOpen\) for \(const k of KG_ONLY_COLS\) set\.add\(k\)/);
  });

  it("итог по «Объёму выкупа» не считается", () => {
    // Решение D5: одна закупка стоит в нескольких сделках — сумма по
    // строкам многократно завысила бы объём. Ячейки бэнда в «Итого» пустые.
    const totals = SRC.slice(SRC.indexOf("function PassportTotalsRow"));
    expect(totals).toContain('{blank("yellow")}{blank("yellow")}{blank("yellow")}');
    // «Сумма оплаты» / «Дата оплаты» (00181) — тоже пустые в «Итого».
    expect(totals.match(/blank\("yellow"\)/g)?.length).toBe(5);
    expect(totals).not.toMatch(/upstream/i);
  });
});
