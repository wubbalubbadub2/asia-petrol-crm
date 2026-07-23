"use client";
/**
 * Таблица отчёта «Сбор по валюте» — 25 колонок из ТЗ клиента
 * (files/Обработка сбор по валюте (1).docx), строка = сделка.
 * Бэнды и цвета — как в паспорте, чтобы взгляд не переучивался.
 */
import Link from "next/link";
import type { FxDealRow } from "@/lib/fx/convert-deal";
import { currencySymbol } from "@/lib/constants/currencies";

const money = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vol = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

type Band = "deal" | "supplier" | "groups" | "buyer" | "logistics";

const BAND_BG: Record<Band, string> = {
  deal: "bg-stone-100",
  supplier: "bg-amber-50",
  groups: "bg-stone-50",
  buyer: "bg-sky-50",
  logistics: "bg-emerald-50",
};

type Col = {
  key: string;
  header: string;
  band: Band;
  align?: "right";
  cell: (r: FxDealRow) => React.ReactNode;
  total?: (rows: FxDealRow[]) => React.ReactNode;
};

const sum = (rows: FxDealRow[], pick: (r: FxDealRow) => number | null) => {
  let t = 0;
  for (const r of rows) t += pick(r) ?? 0;
  return t;
};

const COLS: Col[] = [
  { key: "code", header: "№ сделки", band: "deal",
    cell: (r) => (
      <Link href={`/deals/${r.id}`} className="font-mono text-[11px] font-bold text-amber-700 underline decoration-amber-300 hover:text-amber-900">
        {r.dealCode}
      </Link>
    ) },
  { key: "month", header: "Месяц", band: "deal", cell: (r) => r.month ?? "—" },
  { key: "factory", header: "Завод", band: "deal", cell: (r) => r.factory || "—" },
  { key: "fuel", header: "ГСМ", band: "deal", cell: (r) => r.fuel || "—" },

  { key: "supplier", header: "Поставщик", band: "supplier", cell: (r) => r.supplier || "—" },
  { key: "sup_contract", header: "Договор", band: "supplier", cell: (r) => r.supplierContract || "—" },
  { key: "sup_price", header: "Цена", band: "supplier", align: "right", cell: (r) => money(r.supplierPrice) },
  { key: "sup_amount", header: "Приход сумма", band: "supplier", align: "right",
    cell: (r) => money(r.supplierAmount), total: (rows) => money(sum(rows, (r) => r.supplierAmount)) },
  { key: "sup_volume", header: "Приход объем", band: "supplier", align: "right",
    cell: (r) => vol(r.supplierVolume), total: (rows) => vol(sum(rows, (r) => r.supplierVolume)) },
  { key: "sup_payment", header: "Оплата", band: "supplier", align: "right",
    cell: (r) => money(r.supplierPayment), total: (rows) => money(sum(rows, (r) => r.supplierPayment)) },
  { key: "sup_balance", header: "Баланс", band: "supplier", align: "right",
    cell: (r) => money(r.supplierBalance), total: (rows) => money(sum(rows, (r) => r.supplierBalance)) },

  { key: "chain", header: "Группа компании", band: "groups", cell: (r) => r.chain || "—" },

  { key: "buyer", header: "Покупатель", band: "buyer", cell: (r) => r.buyer || "—" },
  { key: "buy_contract", header: "Договор", band: "buyer", cell: (r) => r.buyerContract || "—" },
  { key: "buy_price", header: "Цена", band: "buyer", align: "right", cell: (r) => money(r.buyerPrice) },
  { key: "buy_volume", header: "Отгружено тонн", band: "buyer", align: "right",
    cell: (r) => vol(r.buyerVolume), total: (rows) => vol(sum(rows, (r) => r.buyerVolume)) },
  { key: "buy_amount", header: "Отгружено сумма", band: "buyer", align: "right",
    cell: (r) => money(r.buyerAmount), total: (rows) => money(sum(rows, (r) => r.buyerAmount)) },
  { key: "buy_payment", header: "Оплата", band: "buyer", align: "right",
    cell: (r) => money(r.buyerPayment), total: (rows) => money(sum(rows, (r) => r.buyerPayment)) },
  { key: "buy_debt", header: "Долг", band: "buyer", align: "right",
    cell: (r) => money(r.buyerDebt), total: (rows) => money(sum(rows, (r) => r.buyerDebt)) },

  { key: "forwarder", header: "Экспедитор", band: "logistics", cell: (r) => r.forwarder || "—" },
  { key: "log_group", header: "Группа компании", band: "logistics", cell: (r) => r.logisticsGroup || "—" },
  { key: "tariff", header: "Тариф факт", band: "logistics", align: "right", cell: (r) => money(r.actualTariff) },
  { key: "act_volume", header: "Факт объем", band: "logistics", align: "right",
    cell: (r) => vol(r.actualVolume), total: (rows) => vol(sum(rows, (r) => r.actualVolume)) },
  { key: "rail_amount", header: "Сумма", band: "logistics", align: "right",
    cell: (r) => money(r.railAmount), total: (rows) => money(sum(rows, (r) => r.railAmount)) },
  { key: "shipper_amount", header: "Сумма грузоотправления", band: "logistics", align: "right",
    cell: (r) => money(r.shipperAmount), total: (rows) => money(sum(rows, (r) => r.shipperAmount)) },
];

export function CollectionTable({ rows, currency }: { rows: FxDealRow[]; currency: string }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
        <p className="text-sm text-stone-500">Нет сделок под текущими фильтрами</p>
      </div>
    );
  }
  return (
    <div className="overflow-auto rounded-md border border-stone-200 bg-white max-h-[calc(100vh-260px)]">
      <table className="w-max border-collapse text-[11px]">
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.key}
                  className={`sticky top-0 z-10 border-r border-b border-stone-200 px-2 py-1.5 font-medium text-stone-700 whitespace-nowrap ${BAND_BG[c.band]} ${c.align === "right" ? "text-right" : "text-left"}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`hover:bg-amber-50/40 ${r.incomplete ? "bg-red-50/40" : ""}`}
                title={r.incomplete ? "Не хватило курса на дату одного из событий — часть сумм пустая" : undefined}>
              {COLS.map((c) => (
                <td key={c.key}
                    className={`border-r border-b border-stone-100 px-2 py-1 whitespace-nowrap ${c.align === "right" ? "text-right font-mono tabular-nums" : ""}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-stone-100 border-t-2 border-stone-300">
            {COLS.map((c, i) => (
              <td key={c.key}
                  className={`sticky bottom-0 border-r border-stone-200 px-2 py-1.5 font-semibold whitespace-nowrap bg-stone-100 ${c.align === "right" ? "text-right font-mono tabular-nums" : ""}`}>
                {i === 0 ? `Итого (${rows.length}) ${currencySymbol(currency)}` : c.total?.(rows) ?? ""}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
