import { describe, it, expect } from "vitest";
import { isRefundKind, signedAmount, splitPaymentTotals } from "@/lib/payments/totals";

describe("isRefundKind", () => {
  it("возврат и перезачёт минусуют, обычная оплата — нет", () => {
    expect(isRefundKind("refund")).toBe(true);
    expect(isRefundKind("offset")).toBe(true);
    expect(isRefundKind("payment")).toBe(false);
  });

  it("null/undefined трактуется как обычная оплата (старые строки до 00051)", () => {
    expect(isRefundKind(null)).toBe(false);
    expect(isRefundKind(undefined)).toBe(false);
  });
});

describe("signedAmount", () => {
  it("возврат уходит в минус, оплата остаётся плюсом", () => {
    expect(signedAmount({ amount: 100, payment_type: "payment" })).toBe(100);
    expect(signedAmount({ amount: 100, payment_type: "refund" })).toBe(-100);
    expect(signedAmount({ amount: 100, payment_type: "offset" })).toBe(-100);
  });

  it("null-сумма считается нулём", () => {
    expect(signedAmount({ amount: null, payment_type: "refund" })).toBe(0);
  });
});

describe("splitPaymentTotals", () => {
  it("норма: две оплаты, возврат и перезачёт", () => {
    expect(
      splitPaymentTotals([
        { amount: 100, payment_type: "payment" },
        { amount: 200, payment_type: "payment" },
        { amount: 30, payment_type: "refund" },
        { amount: 20, payment_type: "offset" },
      ]),
    ).toEqual({ gross: 300, refund: 50, net: 250 });
  });

  it("граница: только возвраты — брутто ноль, нетто отрицательное", () => {
    expect(splitPaymentTotals([{ amount: 40, payment_type: "refund" }])).toEqual({
      gross: 0,
      refund: 40,
      net: -40,
    });
  });

  it("пустой список — все нули", () => {
    expect(splitPaymentTotals([])).toEqual({ gross: 0, refund: 0, net: 0 });
  });

  it("возвраты всегда положительны, знак живёт только в net", () => {
    const t = splitPaymentTotals([
      { amount: 500, payment_type: "payment" },
      { amount: 120, payment_type: "offset" },
    ]);
    expect(t.refund).toBeGreaterThan(0);
    expect(t.net).toBe(t.gross - t.refund);
  });
});
