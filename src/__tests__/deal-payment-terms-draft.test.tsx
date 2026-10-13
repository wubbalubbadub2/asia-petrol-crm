import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DealPaymentTermsDraft,
  EMPTY_PAYMENT_TERMS,
  paymentTermsDraftToDealPatch,
  type PaymentTermsDraft,
} from "@/components/deals/deal-payment-terms-draft";

// Клиент 2026-10-13: «Условия оплаты… можно добавить и при создании
// сделки, чтобы сразу вносить». Блок повторяет карточку сделки
// (PaymentConditionsSection): отсрочка, режим, при «прочее» — заметка
// и ручная плановая дата. Пишется в те же колонки deals (00125/00142).
describe("DealPaymentTermsDraft", () => {
  function setup(supplier: PaymentTermsDraft = EMPTY_PAYMENT_TERMS, buyer: PaymentTermsDraft = EMPTY_PAYMENT_TERMS) {
    const onSupplierChange = vi.fn();
    const onBuyerChange = vi.fn();
    const utils = render(
      <DealPaymentTermsDraft supplier={supplier} buyer={buyer} onSupplierChange={onSupplierChange} onBuyerChange={onBuyerChange} />,
    );
    return { ...utils, onSupplierChange, onBuyerChange };
  }

  it("показывает обе стороны с отсрочкой и режимом, без полей «прочее»", () => {
    setup();
    expect(screen.getByText("Поставщик")).toBeTruthy();
    expect(screen.getByText("Покупатель")).toBeTruthy();
    expect(screen.getAllByLabelText("Отсрочка, дн.")).toHaveLength(2);
    expect(screen.getAllByLabelText("Режим")).toHaveLength(2);
    expect(screen.queryByLabelText("Заметка")).toBeNull();
    expect(screen.queryByLabelText("Плановая дата (ручная)")).toBeNull();
  });

  it("ввод отсрочки и выбор режима уходят в onChange своей стороны", () => {
    const { onSupplierChange, onBuyerChange } = setup();
    const [supDays, buyDays] = screen.getAllByLabelText("Отсрочка, дн.");
    fireEvent.change(supDays, { target: { value: "30" } });
    expect(onSupplierChange).toHaveBeenLastCalledWith({ ...EMPTY_PAYMENT_TERMS, days: "30" });
    fireEvent.change(buyDays, { target: { value: "14" } });
    expect(onBuyerChange).toHaveBeenLastCalledWith({ ...EMPTY_PAYMENT_TERMS, days: "14" });
    const [, buyMode] = screen.getAllByLabelText("Режим");
    fireEvent.change(buyMode, { target: { value: "other" } });
    expect(onBuyerChange).toHaveBeenLastCalledWith({ ...EMPTY_PAYMENT_TERMS, mode: "other" });
  });

  it("режим «прочее» раскрывает заметку и ручную плановую дату только у своей стороны", () => {
    setup({ ...EMPTY_PAYMENT_TERMS, mode: "other" }, EMPTY_PAYMENT_TERMS);
    expect(screen.getAllByLabelText("Заметка")).toHaveLength(1);
    expect(screen.getAllByLabelText("Плановая дата (ручная)")).toHaveLength(1);
  });
});

describe("paymentTermsDraftToDealPatch", () => {
  it("пустая форма — все восемь колонок NULL, как у сделки без условий", () => {
    expect(paymentTermsDraftToDealPatch(EMPTY_PAYMENT_TERMS, EMPTY_PAYMENT_TERMS)).toEqual({
      supplier_deferral_days: null,
      supplier_deferral_mode: null,
      supplier_deferral_note: null,
      supplier_planned_pay_date: null,
      buyer_deferral_days: null,
      buyer_deferral_mode: null,
      buyer_deferral_note: null,
      buyer_planned_pay_date: null,
    });
  });

  it("дни — целое число, заметка и дата пишутся только при режиме «прочее»", () => {
    const patch = paymentTermsDraftToDealPatch(
      { days: "30", mode: "shipment", note: "забытая заметка", plannedPayDate: "2026-11-01" },
      { days: "14", mode: "other", note: "по письму", plannedPayDate: "2026-11-15" },
    );
    expect(patch).toEqual({
      supplier_deferral_days: 30,
      supplier_deferral_mode: "shipment",
      supplier_deferral_note: null,
      supplier_planned_pay_date: null,
      buyer_deferral_days: 14,
      buyer_deferral_mode: "other",
      buyer_deferral_note: "по письму",
      buyer_planned_pay_date: "2026-11-15",
    });
  });
});
