/**
 * «Закупка» (у кого купили) — 00180.
 *
 * Держит: чтение встраивания закупки в строке сделки, условие показа
 * блока в карточке, признак «продано больше, чем закуплено», и место
 * трёх колонок в обеих выгрузках паспорта (только KG, перед
 * «Поставщиком», без итога по «Объёму выкупа» — решение D5).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  upstreamSeller,
  upstreamAppendix,
  upstreamVolume,
  upstreamPaidByCurrency,
  upstreamPaidLabel,
  upstreamLastPaymentDate,
  totalsNumbers,
  isOversold,
  showsUpstreamBlock,
} from "@/lib/deals/upstream-purchase";
import { passportColumns, PASSPORT_COLUMNS } from "@/lib/exports/passport-excel";
import { detailColumns, DETAIL_COLUMNS } from "@/lib/exports/passport-detail-excel";

const linked = {
  upstream_purchase: {
    appendix: "П-12",
    volume_tons: "1500.250",
    seller: { short_name: "Газпромнефть", full_name: "ПАО «Газпром нефть»" },
  },
};

describe("закупка: чтение строки сделки", () => {
  it("продавец — краткое имя, иначе полное", () => {
    expect(upstreamSeller(linked)).toBe("Газпромнефть");
    expect(upstreamSeller({ upstream_purchase: { ...linked.upstream_purchase, seller: { short_name: null, full_name: "ПАО «Газпром нефть»" } } }))
      .toBe("ПАО «Газпром нефть»");
  });

  it("приложение и объём; numeric строкой тоже читается", () => {
    expect(upstreamAppendix(linked)).toBe("П-12");
    expect(upstreamVolume(linked)).toBe(1500.25);
  });

  it("сделка без закупки — пустые ячейки, не падение", () => {
    expect(upstreamSeller({})).toBe("");
    expect(upstreamAppendix({ upstream_purchase: null })).toBe("");
    expect(upstreamVolume({ upstream_purchase: null })).toBeNull();
  });
});

describe("закупка: числа из вью и предупреждение", () => {
  it("числа вью приводятся к number", () => {
    expect(totalsNumbers({ purchase_id: "p", deal_count: 2, sold_tons: "1000.000", remaining_tons: "-20.500" }))
      .toEqual({ sold: 1000, remaining: -20.5, dealCount: 2 });
  });

  it("нет строки во вью — продано 0, остаток неизвестен", () => {
    expect(totalsNumbers(undefined)).toEqual({ sold: 0, remaining: null, dealCount: 0 });
  });

  it("минус — предупреждение, ноль и плюс — нет", () => {
    expect(isOversold(-0.001)).toBe(true);
    expect(isOversold(0)).toBe(false);
    expect(isOversold(10)).toBe(false);
    expect(isOversold(null)).toBe(false);
  });
});

describe("закупка: когда виден блок в карточке", () => {
  it("KG + наша компания", () => {
    expect(showsUpstreamBlock("KG", true, null)).toBe(true);
  });
  it("KG, поставщик не наш и не привязано — нет", () => {
    expect(showsUpstreamBlock("KG", false, null)).toBe(false);
  });
  it("KG, уже привязано — показываем всегда", () => {
    expect(showsUpstreamBlock("KG", undefined, "p1")).toBe(true);
  });
  it("KZ — никогда", () => {
    expect(showsUpstreamBlock("KZ", true, "p1")).toBe(false);
  });
});

type Col = { key: string; header: string; band: string; read: (d: never) => unknown };

describe.each([
  ["краткий паспорт", passportColumns as (t: "KG" | "KZ" | "ALL") => readonly unknown[], PASSPORT_COLUMNS as readonly unknown[]],
  ["детальный паспорт", detailColumns as (t: "KG" | "KZ" | "ALL") => readonly unknown[], DETAIL_COLUMNS as readonly unknown[]],
])("%s: колонки закупки", (_name, build, base) => {
  it("в KG колонки закупки стоят в конце (клиент 2026-10-07)", () => {
    const cols = build("KG") as Col[];
    const keys = cols.map((c) => c.key);
    const at = keys.indexOf("upstream_seller");
    expect(at).toBe(cols.length - 5);
    expect(keys.slice(at)).toEqual(["upstream_seller", "upstream_appendix", "upstream_volume", "upstream_paid", "upstream_paid_date"]);
    expect(cols.slice(at).map((c) => c.header)).toEqual(["Первичный поставщик", "Номер приложения", "Объём выкупа, т", "Сумма оплаты", "Дата оплаты"]);
    expect(cols.slice(at).every((c) => c.band === "upstream")).toBe(true);
    expect(cols.length).toBe(base.length + 5);
  });

  it("в KZ и «Всех сделках» колонок нет", () => {
    for (const t of ["KZ", "ALL"] as const) {
      expect((build(t) as Col[]).some((c) => c.band === "upstream")).toBe(false);
    }
  });

  it("читают закупку из строки сделки", () => {
    const cols = build("KG") as Col[];
    const col = (k: string) => cols.find((c) => c.key === k)!;
    expect(col("upstream_seller").read(linked as never)).toBe("Газпромнефть");
    expect(col("upstream_volume").read(linked as never)).toBe(1500.25);
  });
});

describe("выгрузки: «Объём выкупа» в итог не входит (D5)", () => {
  it.each(["src/lib/exports/passport-excel.ts", "src/lib/exports/passport-detail-excel.ts"])("%s", (file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    const start = src.indexOf("const TOTAL_KEYS = new Set([");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("]);", start));
    expect(block).not.toContain("upstream");
  });
});

// Оплаты по закупке (00181, клиент 2026-10-07): сумма по валютам и
// последняя дата; одна закупка — несколько сделок, итог не суммируется.
describe("оплаты закупки в паспорте", () => {
  const withPays = (payments: { amount: number | string; currency: string; payment_date: string }[] | null) => ({
    upstream_purchase: { appendix: "1", volume_tons: 1, seller: null, payments },
  });

  it("сумма по валютам, без пересчёта, валюты по алфавиту", () => {
    const d = withPays([
      { amount: 100000.5, currency: "USD", payment_date: "2026-09-16" },
      { amount: "9000000", currency: "KZT", payment_date: "2026-09-18" },
      { amount: 50000.25, currency: "USD", payment_date: "2026-09-20" },
    ]);
    expect(upstreamPaidByCurrency(d)).toEqual([
      { currency: "KZT", amount: 9000000 },
      { currency: "USD", amount: 150000.75 },
    ]);
    expect(upstreamPaidLabel(d).replace(/ /g, " ")).toBe("9 000 000,00 KZT; 150 000,75 USD");
  });

  it("копейки складываются без хвоста дроби", () => {
    const d = withPays([
      { amount: 0.1, currency: "USD", payment_date: "2026-09-01" },
      { amount: 0.2, currency: "USD", payment_date: "2026-09-02" },
    ]);
    expect(upstreamPaidByCurrency(d)).toEqual([{ currency: "USD", amount: 0.3 }]);
  });

  it("дата оплаты — последняя", () => {
    const d = withPays([
      { amount: 1, currency: "USD", payment_date: "2026-09-20" },
      { amount: 1, currency: "KZT", payment_date: "2026-10-02" },
      { amount: 1, currency: "USD", payment_date: "2026-09-16" },
    ]);
    expect(upstreamLastPaymentDate(d)).toBe("2026-10-02");
  });

  it("без закупки или без оплат — пусто", () => {
    expect(upstreamPaidLabel({})).toBe("");
    expect(upstreamPaidLabel(withPays(null))).toBe("");
    expect(upstreamLastPaymentDate(withPays([]))).toBeNull();
  });
});
