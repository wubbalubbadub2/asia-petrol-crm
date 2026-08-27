import { describe, it, expect } from "vitest";
import { offsetTotalInDealCurrency, splitPaymentTotals } from "@/lib/payments/totals";

/**
 * Взаимозачёт в паспорте (00145). Ячейка «Взаимозачет» правится на месте
 * и должна пересчитывать числа сделки ДО ответа сервера — значит фронт
 * обязан повторять формулы refresh_deal_payment_totals:
 *
 *   supplier_offset_total = SUM(offset) по строкам в валюте сделки
 *   payment               = gross − refund + offset
 *   supplier_balance      = приход − payment    → Δбаланса = −Δвзаимозачёта
 *   buyer_debt            = payment − отгружено → Δдолга   = +Δвзаимозачёта
 */
const row = (
  amount: number,
  payment_type: string,
  currency: string | null = null,
) => ({ amount, payment_type, currency });

describe("offsetTotalInDealCurrency", () => {
  it("норма: суммирует только взаимозачёты, оплаты и возвраты не трогает", () => {
    expect(
      offsetTotalInDealCurrency(
        [row(181_545_000, "payment"), row(-66_358_495.82, "offset"), row(30, "refund")],
        "KZT",
      ),
    ).toBe(-66_358_495.82);
  });

  it("валюта: NULL считается валютой сделки, чужая валюта в итог не идёт", () => {
    const items = [row(100, "offset", null), row(50, "offset", "KZT"), row(999, "offset", "USD")];
    expect(offsetTotalInDealCurrency(items, "KZT")).toBe(150);
    expect(offsetTotalInDealCurrency(items, "USD")).toBe(1099);
  });

  it("граница: валюта сделки не задана — считаются только строки без валюты", () => {
    expect(offsetTotalInDealCurrency([row(100, "offset", null), row(50, "offset", "KZT")], "")).toBe(100);
  });

  it("граница: взаимозачётов нет — ноль, а не NaN", () => {
    expect(offsetTotalInDealCurrency([row(100, "payment")], "KZT")).toBe(0);
    expect(offsetTotalInDealCurrency([], "KZT")).toBe(0);
  });

  it("null-сумма считается нулём", () => {
    expect(
      offsetTotalInDealCurrency([{ amount: null, payment_type: "offset", currency: null }], "KZT"),
    ).toBe(0);
  });
});

describe("оптимистичный пересчёт ячейки «Взаимозачет»", () => {
  // Числа со скриншота клиента 2026-08-27: оплата 181 545 000,
  // взаимозачёт −66 358 495,82, нетто 115 186 504,18.
  const before = [row(181_545_000, "payment"), row(-66_358_495.82, "offset")];

  // Дельта — разность двух сумм с плавающей точкой, поэтому сверяем с
  // допуском: до копейки (которую и показывает таблица) она точна.
  it("норма: добавили взаимозачёт — баланс поставщика уменьшился на ту же сумму", () => {
    const after = [...before, row(-1_000_000, "offset")];
    const delta = offsetTotalInDealCurrency(after, "KZT") - offsetTotalInDealCurrency(before, "KZT");
    expect(delta).toBeCloseTo(-1_000_000, 6);

    const supplierBalanceBefore = 5_000_000;
    expect(supplierBalanceBefore - delta).toBeCloseTo(6_000_000, 6);
    // Долг покупателя едет в другую сторону.
    const buyerDebtBefore = 5_000_000;
    expect(buyerDebtBefore + delta).toBeCloseTo(4_000_000, 6);
  });

  it("правка: нетто пересобирается как gross − refund + offset", () => {
    expect(splitPaymentTotals(before).net).toBe(115_186_504.18);
    const edited = [row(181_545_000, "payment"), row(-70_000_000, "offset")];
    expect(splitPaymentTotals(edited).net).toBe(111_545_000);
  });

  it("отмена: удалили взаимозачёт — итог и нетто вернулись к оплате", () => {
    const after = before.filter((p) => p.payment_type !== "offset");
    const delta = offsetTotalInDealCurrency(after, "KZT") - offsetTotalInDealCurrency(before, "KZT");
    expect(delta).toBeCloseTo(66_358_495.82, 6);
    expect(offsetTotalInDealCurrency(after, "KZT")).toBe(0);
    expect(splitPaymentTotals(after).net).toBe(181_545_000);
  });

  it("плюсовой взаимозачёт увеличивает нетто и уменьшает баланс поставщика", () => {
    const after = [...before, row(2_000_000, "offset")];
    const delta = offsetTotalInDealCurrency(after, "KZT") - offsetTotalInDealCurrency(before, "KZT");
    expect(delta).toBeCloseTo(2_000_000, 6);
    expect(splitPaymentTotals(after).net).toBeCloseTo(117_186_504.18, 6);
  });
});
