import { describe, it, expect } from "vitest";
import { isOffsetKind, isRefundKind, signedAmount, splitPaymentTotals } from "@/lib/payments/totals";

describe("isRefundKind", () => {
  it("возврат и взаимозачёт — не обычная оплата", () => {
    expect(isRefundKind("refund")).toBe(true);
    expect(isRefundKind("offset")).toBe(true);
    expect(isRefundKind("payment")).toBe(false);
  });

  it("null/undefined трактуется как обычная оплата (старые строки до 00051)", () => {
    expect(isRefundKind(null)).toBe(false);
    expect(isRefundKind(undefined)).toBe(false);
  });
});

describe("isOffsetKind", () => {
  it("выделяет только взаимозачёт", () => {
    expect(isOffsetKind("offset")).toBe(true);
    expect(isOffsetKind("refund")).toBe(false);
    expect(isOffsetKind("payment")).toBe(false);
    expect(isOffsetKind(null)).toBe(false);
  });
});

describe("signedAmount", () => {
  it("возврат уходит в минус, оплата остаётся плюсом", () => {
    expect(signedAmount({ amount: 100, payment_type: "payment" })).toBe(100);
    expect(signedAmount({ amount: 100, payment_type: "refund" })).toBe(-100);
  });

  // 00145: взаимозачёт хранит знак в самой сумме и прибавляется.
  it("взаимозачёт идёт со своим знаком, а не минусуется", () => {
    expect(signedAmount({ amount: 120, payment_type: "offset" })).toBe(120);
    expect(signedAmount({ amount: -120, payment_type: "offset" })).toBe(-120);
  });

  it("null-сумма считается нулём", () => {
    expect(signedAmount({ amount: null, payment_type: "refund" })).toBe(0);
  });
});

describe("splitPaymentTotals", () => {
  it("норма: две оплаты, возврат и взаимозачёт", () => {
    expect(
      splitPaymentTotals([
        { amount: 100, payment_type: "payment" },
        { amount: 200, payment_type: "payment" },
        { amount: 30, payment_type: "refund" },
        { amount: 20, payment_type: "offset" },
      ]),
    ).toEqual({ gross: 300, refund: 30, offset: 20, net: 290 });
  });

  // Формула refresh_deal_payment_totals (00145):
  // payment = gross − refund + offset.
  it("минусовой взаимозачёт уменьшает нетто, плюсовой — увеличивает", () => {
    expect(
      splitPaymentTotals([
        { amount: 181_545_000, payment_type: "payment" },
        { amount: -66_358_495.82, payment_type: "offset" },
      ]),
    ).toEqual({ gross: 181_545_000, refund: 0, offset: -66_358_495.82, net: 115_186_504.18 });

    expect(splitPaymentTotals([{ amount: 50, payment_type: "offset" }]).net).toBe(50);
  });

  it("граница: только возвраты — брутто ноль, нетто отрицательное", () => {
    expect(splitPaymentTotals([{ amount: 40, payment_type: "refund" }])).toEqual({
      gross: 0,
      refund: 40,
      offset: 0,
      net: -40,
    });
  });

  it("пустой список — все нули", () => {
    expect(splitPaymentTotals([])).toEqual({ gross: 0, refund: 0, offset: 0, net: 0 });
  });

  it("возвраты всегда положительны, знак взаимозачёта живёт в offset", () => {
    const t = splitPaymentTotals([
      { amount: 500, payment_type: "payment" },
      { amount: 30, payment_type: "refund" },
      { amount: -120, payment_type: "offset" },
    ]);
    expect(t.refund).toBeGreaterThan(0);
    expect(t.offset).toBeLessThan(0);
    expect(t.net).toBe(t.gross - t.refund + t.offset);
  });
});
