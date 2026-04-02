"use client";

import Link from "next/link";
import { type Deal } from "@/lib/hooks/use-deals";

function formatNum(val: number | null | undefined): string {
  if (val == null || val === 0) return "";
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function FuelDot({ color }: { color?: string }) {
  return <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color ?? "#6B7280" }} />;
}

function DealTypeBadge({ type }: { type: string }) {
  const c = type === "KG" ? "text-blue-600" : type === "KZ" ? "text-green-600" : "text-purple-600";
  return <span className={`text-[10px] font-medium ${c}`}>{type}</span>;
}

type PassportTableProps = {
  deals: Deal[];
  loading: boolean;
  dealType: "KG" | "KZ";
};

export function PassportTable({ deals, loading, dealType }: PassportTableProps) {
  const currency = dealType === "KZ" ? "₸" : "$";

  if (loading) return <p className="text-sm text-muted-foreground py-4">Загрузка паспорта...</p>;

  if (deals.length === 0) {
    return (
      <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
        <p className="text-sm text-stone-500">Нет сделок типа {dealType}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
      <table className="w-max border-collapse" style={{ fontSize: "11px" }}>
        <thead>
          {/* Column group headers */}
          <tr className="bg-stone-100 border-b">
            <th colSpan={5} className="border-r border-stone-300 px-2 py-1 text-center text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
              Сделка
            </th>
            <th colSpan={6} className="border-r border-stone-300 px-2 py-1 text-center text-[10px] font-semibold text-amber-700 uppercase tracking-wider bg-amber-50/50">
              Поставщик
            </th>
            <th colSpan={7} className="border-r border-stone-300 px-2 py-1 text-center text-[10px] font-semibold text-blue-700 uppercase tracking-wider bg-blue-50/50">
              Покупатель
            </th>
            <th colSpan={5} className="px-2 py-1 text-center text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
              Логистика
            </th>
          </tr>
          {/* Column headers */}
          <tr className="bg-stone-50 border-b">
            {/* Deal identity (frozen) */}
            <th className="sticky left-0 z-20 bg-stone-50 border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">№</th>
            <th className="sticky left-[70px] z-20 bg-stone-50 border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[60px]">Месяц</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[70px]">Завод</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px]">ГСМ</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-left font-medium text-stone-600 min-w-[50px]">% S</th>

            {/* Supplier */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[120px] bg-amber-50/30">Поставщик</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px] bg-amber-50/30">Договор</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-amber-50/30">Объем</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-amber-50/30">Цена</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[90px] bg-amber-50/30">Отгружено {currency}</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-600 min-w-[90px] bg-amber-50/30">Оплата {currency}</th>

            {/* Buyer */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[120px] bg-blue-50/30">Покупатель</th>
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px] bg-blue-50/30">Договор</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Объем</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Цена</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Заявлено</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px] bg-blue-50/30">Отгружено</th>
            <th className="border-r border-stone-300 px-2 py-1.5 text-right font-medium text-stone-600 min-w-[90px] bg-blue-50/30">Оплата {currency}</th>

            {/* Logistics */}
            <th className="border-r px-2 py-1.5 text-left font-medium text-stone-600 min-w-[100px]">Экспедитор</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[60px]">Тариф</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[70px]">Факт объем</th>
            <th className="border-r px-2 py-1.5 text-right font-medium text-stone-600 min-w-[80px]">Сумма СФ</th>
            <th className="px-2 py-1.5 text-left font-medium text-stone-600 min-w-[80px]">Менеджер</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-b hover:bg-amber-50/20">
              {/* Deal identity (frozen) */}
              <td className="sticky left-0 z-10 bg-white border-r px-2 py-1 font-mono font-medium text-amber-700">
                <Link href={`/deals/${deal.id}`} className="hover:underline">{deal.deal_code}</Link>
              </td>
              <td className="sticky left-[70px] z-10 bg-white border-r px-2 py-1 text-stone-600">{deal.month}</td>
              <td className="border-r px-2 py-1 text-stone-600">{deal.factory?.name ?? ""}</td>
              <td className="border-r px-2 py-1">
                {deal.fuel_type ? (
                  <span className="inline-flex items-center gap-1">
                    <FuelDot color={deal.fuel_type.color} />
                    <span className="text-stone-700">{deal.fuel_type.name}</span>
                  </span>
                ) : ""}
              </td>
              <td className="border-r border-stone-300 px-2 py-1 text-stone-500">{deal.sulfur_percent ?? ""}</td>

              {/* Supplier */}
              <td className="border-r px-2 py-1 text-stone-700 bg-amber-50/10 truncate max-w-[120px]">{deal.supplier?.short_name ?? ""}</td>
              <td className="border-r px-2 py-1 text-stone-500 bg-amber-50/10 truncate max-w-[80px]">{deal.supplier_contract ?? ""}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10">{formatNum(deal.supplier_contracted_volume)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10">{formatNum(deal.supplier_price)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10">{formatNum(deal.supplier_shipped_amount)}</td>
              <td className="border-r border-stone-300 px-2 py-1 text-right font-mono tabular-nums bg-amber-50/10">{formatNum(deal.supplier_payment)}</td>

              {/* Buyer */}
              <td className="border-r px-2 py-1 text-stone-700 bg-blue-50/10 truncate max-w-[120px]">{deal.buyer?.short_name ?? ""}</td>
              <td className="border-r px-2 py-1 text-stone-500 bg-blue-50/10 truncate max-w-[80px]">{deal.buyer_contract ?? ""}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10">{formatNum(deal.buyer_contracted_volume)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10">{formatNum(deal.buyer_price)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10">{formatNum(deal.buyer_ordered_volume)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10">{formatNum(deal.buyer_shipped_volume)}</td>
              <td className="border-r border-stone-300 px-2 py-1 text-right font-mono tabular-nums bg-blue-50/10">{formatNum(deal.buyer_payment)}</td>

              {/* Logistics */}
              <td className="border-r px-2 py-1 text-stone-600 truncate max-w-[100px]">{deal.forwarder?.name ?? ""}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums">{formatNum(deal.planned_tariff)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums">{formatNum(deal.actual_shipped_volume)}</td>
              <td className="border-r px-2 py-1 text-right font-mono tabular-nums">{formatNum(deal.invoice_amount)}</td>
              <td className="px-2 py-1 text-stone-500">{deal.supplier_manager?.full_name ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
