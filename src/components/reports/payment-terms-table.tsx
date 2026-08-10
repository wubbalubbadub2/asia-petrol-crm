"use client";
/**
 * Таблица отчёта «Условия оплаты» — колонки из файла-примера клиента
 * (10.08.2026). Строка = сделка + приложение + дата СНТ; вагоны одной
 * даты сложены (в примере объёмы 440–614 т, то есть 7–10 вагонов).
 *
 * Три отличия от присланного файла, согласованы 10.08.2026:
 *   • «просрочка» → «Дней до оплаты»: положительное число означает, что
 *     просрочки НЕТ, и старое название читалось наоборот;
 *   • «дата + 90/14» → «Плановая дата оплаты»: срок у каждого приложения
 *     свой, зашивать 90/14 в заголовок нельзя;
 *   • срок вынесен в собственную колонку — в файле он ютился сбоку без
 *     заголовка, хотя правится вручную.
 * Служебные столбцы примера (дубль номера сделки, вторая «цена» справа)
 * не переносятся: это ячейки под формулы Excel.
 *
 * Бэнды и цвета — как в паспорте и «Инкассации», чтобы взгляд не
 * переучивался.
 */
import Link from "next/link";
import { formatDMY } from "@/lib/format";
import {
  type PaymentTermsRow,
  groupSaldoMap,
  isOverdueVisible,
} from "@/lib/hooks/use-payment-terms";

const money = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vol = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

type Band = "deal" | "money" | "terms" | "groups";

const BAND_BG: Record<Band, string> = {
  deal: "bg-stone-100",
  money: "bg-amber-50",
  terms: "bg-sky-50",
  groups: "bg-stone-50",
};

const BAND_LABEL: Record<Band, string> = {
  deal: "Сделка",
  money: "Отгрузка и оплата",
  terms: "Условия оплаты",
  groups: "Цепочка",
};

export function PaymentTermsTable({ rows }: { rows: PaymentTermsRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-stone-500">Нет строк по выбранным условиям.</p>;
  }

  // Сальдо по группе «контрагент + приложение» — гасит красный, когда
  // долг закрыт (клиент 2026-08-10).
  const saldoByGroup = groupSaldoMap(rows);

  // Группировка по контрагенту: в файле-примере это тёмная строка-шапка
  // с итогом по сумме отгрузки.
  const byCounterparty = new Map<string, PaymentTermsRow[]>();
  for (const r of rows) {
    const k = r.counterparty_name ?? "—";
    const list = byCounterparty.get(k);
    if (list) list.push(r); else byCounterparty.set(k, [r]);
  }

  const bands: { band: Band; span: number }[] = [
    { band: "deal", span: 3 },
    { band: "money", span: 5 },
    { band: "terms", span: 4 },
    { band: "groups", span: 2 },
  ];
  const th = "border-r px-2 py-1 text-left font-medium whitespace-nowrap";
  const thNum = "border-r px-2 py-1 text-right font-medium whitespace-nowrap";
  const td = "border-r px-2 py-1 whitespace-nowrap";
  const tdNum = "border-r px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap";

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-stone-200 bg-white">
      <table className="w-full border-collapse text-[11px]">
        <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10">
          <tr className="border-b text-stone-500">
            {bands.map((b) => (
              <th key={b.band} colSpan={b.span}
                  className={`${th} ${BAND_BG[b.band]} text-center`}>
                {BAND_LABEL[b.band]}
              </th>
            ))}
          </tr>
          <tr className="border-b bg-stone-100 text-stone-500">
            <th className={th}>Приложение</th>
            <th className={th}>№ сделки</th>
            <th className={th}>Дата отгрузки</th>
            <th className={thNum}>Сумма отгрузки</th>
            <th className={thNum}>Цена</th>
            <th className={thNum}>Отгруженный объём</th>
            <th className={thNum}>Оплата</th>
            <th className={thNum}>Сальдо</th>
            <th className={thNum} title="Срок по приложению, календарных дней">Условия оплаты, дн.</th>
            <th className={th}>Плановая дата оплаты</th>
            <th className={thNum} title="Плановая дата минус сегодня. Минус — просрочка">Дней до оплаты</th>
            <th className={th}>Отсчёт</th>
            <th className={th}>Компания группы</th>
            <th className={th}>Покупатель</th>
          </tr>
        </thead>
        <tbody>
          {[...byCounterparty.entries()].map(([name, list]) => {
            const total = list.reduce((s, r) => s + (r.shipped_amount ?? 0), 0);
            return (
              <FragmentGroup key={name} name={name} total={total} list={list}
                             saldoByGroup={saldoByGroup} td={td} tdNum={tdNum} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentGroup({
  name, total, list, saldoByGroup, td, tdNum,
}: {
  name: string;
  total: number;
  list: PaymentTermsRow[];
  saldoByGroup: Map<string, number>;
  td: string;
  tdNum: string;
}) {
  // Оплата и сальдо живут на СДЕЛКЕ и повторяются в каждой её строке.
  // Печатаем их один раз на сделку — как в файле-примере, где у KG 157
  // две отгрузки, а оплата проставлена на одной строке.
  const seenDeal = new Set<string>();

  return (
    <>
      <tr className="border-b bg-stone-800 text-white">
        <td className="px-2 py-1 font-semibold" colSpan={3}>{name}</td>
        <td className="px-2 py-1 text-right font-mono tabular-nums font-semibold">{money(total)}</td>
        <td colSpan={10} />
      </tr>
      {list.map((r, i) => {
        const overdue = isOverdueVisible(r, saldoByGroup);
        const firstOfDeal = !seenDeal.has(r.deal_id);
        seenDeal.add(r.deal_id);
        return (
          <tr key={`${r.deal_id}-${r.appendix ?? ""}-${r.basis_date}-${i}`}
              className="border-b hover:bg-amber-50/40">
            <td className={td}>{r.appendix || "—"}</td>
            <td className={td}>
              <Link href={`/deals/${r.deal_id}`} className="text-amber-700 hover:underline">
                {r.deal_code ?? "—"}
              </Link>
            </td>
            <td className={td}>{formatDMY(r.basis_date)}</td>
            <td className={tdNum}>{money(r.shipped_amount)}</td>
            <td className={tdNum}>{money(r.price)}</td>
            <td className={tdNum}>{vol(r.shipped_volume)}</td>
            <td className={tdNum}>{firstOfDeal ? money(r.deal_payment) : ""}</td>
            <td className={tdNum}>{firstOfDeal ? money(r.deal_saldo) : ""}</td>
            <td className={tdNum}>{r.deferral_days ?? "—"}</td>
            <td className={td}>{r.planned_pay_date ? formatDMY(r.planned_pay_date) : "—"}</td>
            <td className={`${tdNum} ${overdue ? "font-semibold text-red-600" : ""}`}>
              {r.days_to_pay ?? "—"}
            </td>
            <td className={td}>
              {r.date_basis === "manual"
                ? "вручную"
                : r.date_basis === "loading" ? "вход. СНТ" : "исход. СНТ"}
            </td>
            <td className={td}>{r.company_chain || "—"}</td>
            <td className={td}>{r.buyer_name || "—"}</td>
          </tr>
        );
      })}
    </>
  );
}
