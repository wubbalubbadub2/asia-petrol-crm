/**
 * «Способ расчёта» и «Котировальный период» в детальной выгрузке.
 *
 * Клиент (WhatsApp, 2026-09-19): «в детальной выгрузке ексель добавить
 * столбцы с наименованием способа расчёта и котировального периода:
 * например "средний месяц"—"август". В самой системе менеджеры
 * указывают месяц котировки, но в екселе нет столбцов».
 *
 * Обе колонки читают строку-вариант по умолчанию — те же поля, что
 * показывает карточка сделки (подтип формулы, режим расчёта, месяц или
 * дата расчёта).
 */
import { describe, it, expect } from "vitest";
import { DETAIL_COLUMNS } from "@/lib/exports/passport-detail-excel";
import type { Deal } from "@/lib/hooks/use-deals";

type Col = { key: string; header: string; read: (d: Deal) => unknown };

const col = (key: string): Col => {
  const c = (DETAIL_COLUMNS as unknown as Col[]).find((x) => x.key === key);
  if (!c) throw new Error(`колонка ${key} потерялась`);
  return c;
};

const dealWithLine = (line: Record<string, unknown>) => ({
  id: "d1",
  supplier_lines: [{ id: "l1", is_default: true, ...line }],
  buyer_lines: [{ id: "l2", is_default: true, ...line }],
}) as unknown as Deal;

describe("способ расчёта", () => {
  const method = (line: Record<string, unknown>) => col("supplier_price_method").read(dealWithLine(line));

  it("средний месяц", () => {
    expect(method({ price_condition: "average_month", calc_mode: "avg_month" })).toBe("Средний месяц");
  });

  it("средний месяц в режиме «на дату»", () => {
    expect(method({ price_condition: "average_month", calc_mode: "on_date" })).toBe("Средний месяц (на дату)");
  });

  it("триггер — видно базис и число дней", () => {
    expect(method({ price_condition: "trigger", trigger_basis: "shipment_date", trigger_days: 35 }))
      .toBe("Триггер (от отгрузки, 35 дн.)");
    expect(method({ price_condition: "trigger", trigger_basis: "border_crossing_date", trigger_days: 30 }))
      .toBe("Триггер (от границы, 30 дн.)");
  });

  it("ручные режимы подписаны как в карточке", () => {
    expect(method({ price_condition: "manual" })).toBe("Фикс / Вручную");
    expect(method({ price_condition: "manual_formula" })).toBe("Формульная вручную");
    expect(method({ price_condition: "manual_in_formula" })).toBe("Фикс цена");
  });

  it("строки-варианта нет — ячейка пустая", () => {
    expect(col("supplier_price_method").read({ id: "d2" } as unknown as Deal)).toBe("");
  });
});

describe("котировальный период", () => {
  const period = (line: Record<string, unknown>) => col("buyer_quotation_period").read(dealWithLine(line));

  it("средний месяц — печатается выбранный месяц", () => {
    expect(period({ price_condition: "average_month", calc_mode: "avg_month", selected_month: "август" })).toBe("август");
  });

  it("на дату — печатается дата в формате ДД.ММ.ГГ", () => {
    expect(period({ price_condition: "fixed", selected_date: "2026-08-17" })).toBe("17.08.26");
    expect(period({ price_condition: "average_month", calc_mode: "on_date", selected_date: "2026-08-17" })).toBe("17.08.26");
  });

  it("менеджер месяц не выбрал — пусто, месяц сделки не подставляется", () => {
    expect(period({ price_condition: "average_month", calc_mode: "avg_month", selected_month: null })).toBe("");
  });

  it("у триггера и ручных режимов периода нет", () => {
    expect(period({ price_condition: "trigger", trigger_basis: "shipment_date", trigger_days: 35 })).toBe("");
    expect(period({ price_condition: "manual" })).toBe("");
  });
});

describe("место колонок", () => {
  const at = (key: string) => (DETAIL_COLUMNS as unknown as Col[]).findIndex((c) => c.key === key);

  it("идут сразу за «Биржей» на своей стороне", () => {
    expect(at("supplier_price_method")).toBe(at("supplier_exchange") + 1);
    expect(at("supplier_quotation_period")).toBe(at("supplier_price_method") + 1);
    expect(at("buyer_price_method")).toBe(at("buyer_exchange") + 1);
    expect(at("buyer_quotation_period")).toBe(at("buyer_price_method") + 1);
  });

  it("подписаны так, как просил клиент", () => {
    expect(col("supplier_price_method").header).toBe("Способ расчёта");
    expect(col("buyer_quotation_period").header).toBe("Котировальный период");
  });
});
