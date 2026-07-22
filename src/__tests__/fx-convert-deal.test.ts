import { describe, it, expect } from "vitest";
import { FxRates, type FxRateRow } from "@/lib/fx/rates";
import { convertDeal, monthNumRu, type DealEvents } from "@/lib/fx/convert-deal";
import type { Deal } from "@/lib/hooks/use-deals";

const RATES: FxRateRow[] = [
  { date: "2026-06-10", base_currency: "USD", quote_currency: "KZT", rate: 500 },
  { date: "2026-06-20", base_currency: "USD", quote_currency: "KZT", rate: 400 },
];
const fx = new FxRates(RATES, "2026-07-21");

// Минимальная сделка: только поля, которые читает convertDeal.
function makeDeal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    deal_code: "KG/26/001",
    year: 2026,
    month: "июнь",
    deal_type: "KG",
    supplier_currency: "USD",
    buyer_currency: "USD",
    logistics_currency: "USD",
    supplier_shipped_volume: 100,
    buyer_shipped_volume: 100,
    actual_shipped_volume: 100,
    railway_in_price: false,
    additional_expenses_in_price: false,
    ...over,
  } as unknown as Deal;
}

const EMPTY: DealEvents = { prices: [], payments: [], logistics: [] };

describe("monthNumRu", () => {
  it("переводит русский месяц в номер", () => {
    expect(monthNumRu("июнь")).toBe(6);
    expect(monthNumRu("Декабрь")).toBe(12);
    expect(monthNumRu("не месяц")).toBeNull();
    expect(monthNumRu(null)).toBeNull();
  });
});

describe("convertDeal — паритет с паспортом", () => {
  it("в родной валюте суммы совпадают с исходными", () => {
    const deal = makeDeal();
    const events: DealEvents = {
      prices: [
        { deal_id: "d1", side: "supplier", amount: 1000, shipment_date: "2026-06-10" },
        { deal_id: "d1", side: "supplier", amount: 500, shipment_date: "2026-06-20" },
        { deal_id: "d1", side: "buyer", amount: 2000, shipment_date: "2026-06-20" },
      ],
      payments: [
        { deal_id: "d1", side: "supplier", amount: 600, payment_date: "2026-06-10", currency: null },
        { deal_id: "d1", side: "buyer", amount: 2500, payment_date: "2026-06-20", currency: null },
      ],
      logistics: [],
    };
    const row = convertDeal(deal, events, fx, "USD");
    expect(row.supplierAmount).toBe(1500);
    expect(row.supplierPayment).toBe(600);
    expect(row.supplierBalance).toBe(900);   // 1500 − 600
    expect(row.buyerAmount).toBe(2000);
    expect(row.buyerPayment).toBe(2500);
    expect(row.buyerDebt).toBe(500);         // 2500 − 2000
    expect(row.incomplete).toBe(false);
  });
});

describe("convertDeal — конвертация по дате события", () => {
  it("каждая сумма берёт курс своей даты", () => {
    const deal = makeDeal();
    const events: DealEvents = {
      ...EMPTY,
      prices: [
        { deal_id: "d1", side: "supplier", amount: 1000, shipment_date: "2026-06-10" }, // ×500
        { deal_id: "d1", side: "supplier", amount: 1000, shipment_date: "2026-06-20" }, // ×400
      ],
    };
    const row = convertDeal(deal, events, fx, "KZT");
    expect(row.supplierAmount).toBe(900_000);
  });

  it("цена = сконвертированная сумма ÷ объём", () => {
    const deal = makeDeal({ supplier_shipped_volume: 200 } as Partial<Deal>);
    const events: DealEvents = {
      ...EMPTY,
      prices: [{ deal_id: "d1", side: "supplier", amount: 1000, shipment_date: "2026-06-20" }],
    };
    const row = convertDeal(deal, events, fx, "KZT");
    expect(row.supplierAmount).toBe(400_000);
    expect(row.supplierPrice).toBe(2000);
  });

  it("событие без даты берёт среднемесячный курс месяца сделки", () => {
    const deal = makeDeal();
    const events: DealEvents = {
      ...EMPTY,
      prices: [{ deal_id: "d1", side: "supplier", amount: 100, shipment_date: null }],
    };
    // июнь: (500 + 400) / 2 = 450
    const row = convertDeal(deal, events, fx, "KZT");
    expect(row.supplierAmount).toBe(45_000);
    expect(row.incomplete).toBe(false);
  });

  it("нет курса — сумма пустая, строка помечена неполной", () => {
    const deal = makeDeal({ month: null } as unknown as Partial<Deal>);
    const events: DealEvents = {
      ...EMPTY,
      prices: [{ deal_id: "d1", side: "supplier", amount: 100, shipment_date: null }],
    };
    const row = convertDeal(deal, events, fx, "KZT");
    expect(row.supplierAmount).toBeNull();
    expect(row.incomplete).toBe(true);
  });

  it("валюта строки реестра важнее валюты сделки", () => {
    const deal = makeDeal({ logistics_currency: "USD" } as Partial<Deal>);
    const events: DealEvents = {
      ...EMPTY,
      logistics: [
        { deal_id: "d1", loading_date: "2026-06-20", date: "2026-06-20", shipped_tonnage_amount: 40000, additional_expenses: null, currency: "KZT" },
      ],
    };
    const row = convertDeal(deal, events, fx, "USD");
    expect(row.railAmount).toBe(100); // 40000 KZT ÷ 400
  });
});

describe("convertDeal — галочки «в цене»", () => {
  const events: DealEvents = {
    prices: [{ deal_id: "d1", side: "supplier", amount: 1000, shipment_date: "2026-06-20" }],
    payments: [],
    logistics: [
      { deal_id: "d1", loading_date: "2026-06-20", date: "2026-06-20", shipped_tonnage_amount: 200, additional_expenses: 50, currency: null },
    ],
  };

  it("жд в цене плюсуется к балансу", () => {
    const row = convertDeal(makeDeal({ railway_in_price: true } as Partial<Deal>), events, fx, "USD");
    expect(row.supplierBalance).toBe(1200);
  });

  it("грузоотправитель в цене плюсуется к балансу", () => {
    const row = convertDeal(makeDeal({ additional_expenses_in_price: true } as Partial<Deal>), events, fx, "USD");
    expect(row.supplierBalance).toBe(1050);
  });

  it("галочка не срабатывает, когда исходные валюты сделки и логистики разные", () => {
    const deal = makeDeal({ railway_in_price: true, logistics_currency: "KZT" } as Partial<Deal>);
    const row = convertDeal(deal, events, fx, "USD");
    expect(row.supplierBalance).toBe(1000); // жд НЕ плюсуется — как в паспорте
  });
});
