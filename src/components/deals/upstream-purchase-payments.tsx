"use client";

// Оплаты по закупке — сколько и когда наша компания заплатила первичному
// поставщику (миграция 00181, клиент 2026-10-07). Оплата относится к
// закупке целиком: у всех её сделок она одна и та же. Валюта — у каждой
// оплаты, без пересчёта. На балансы не влияет.
//
// Итог по валютам берём из вью deal_upstream_purchase_payment_totals —
// БД источник истины. Удалять оплату может только admin (RLS).

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { parseNum } from "@/lib/utils/parse-num";
import { formatDMY } from "@/lib/format";
import { CURRENCIES } from "@/lib/constants/currencies";
import { localToday } from "@/lib/applications/deal-link";
import { useRole } from "@/lib/role-context";

// Таблицы и вью оплат нет в сгенерированном database.ts — тот же обход,
// что в карточке закупки.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };
const sbLoose = () => createClient() as unknown as LooseClient;

type Payment = { id: string; amount: number | string; currency: string; payment_date: string; comment: string | null };
type Total = { currency: string; paid_amount: number | string; payment_count: number; last_payment_date: string };

const fmtMoney = (v: number | string) =>
  Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function UpstreamPurchasePayments({ purchaseId, defaultCurrency, canWrite, dealCount, onChanged }: {
  purchaseId: string;
  defaultCurrency: string | null | undefined;
  canWrite: boolean;
  /** Сколько сделок у закупки — предупредить, что оплата видна во всех. */
  dealCount: number;
  onChanged: () => void;
}) {
  const { isAdmin } = useRole();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [totals, setTotals] = useState<Total[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency || "USD");
  const [date, setDate] = useState(() => localToday());
  const [comment, setComment] = useState("");

  // Перечитать — сменой счётчика: загрузка живёт в эффекте и отменяется,
  // если закупка сменилась раньше, чем пришёл ответ.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let cancelled = false;
    const sb = sbLoose();
    void Promise.all([
      sb.from("deal_upstream_purchase_payments")
        .select("id, amount, currency, payment_date, comment")
        .eq("purchase_id", purchaseId)
        .order("payment_date", { ascending: true }),
      sb.from("deal_upstream_purchase_payment_totals")
        .select("currency, paid_amount, payment_count, last_payment_date")
        .eq("purchase_id", purchaseId)
        .order("currency"),
    ]).then(([p, t]) => {
      if (cancelled) return;
      if (p.error) toast.error(`Оплаты закупки: ${p.error.message}`);
      if (t.error) toast.error(`Итог оплат: ${t.error.message}`);
      setPayments((p.data ?? []) as Payment[]);
      setTotals((t.data ?? []) as Total[]);
    });
    return () => { cancelled = true; };
  }, [purchaseId, version]);

  async function add() {
    const n = parseNum(amount);
    if (n == null || n <= 0) { toast.error("Сумма оплаты должна быть больше нуля"); return; }
    if (!date) { toast.error("Укажите дату оплаты"); return; }
    setBusy(true);
    const { error } = await sbLoose().from("deal_upstream_purchase_payments").insert({
      purchase_id: purchaseId, amount: n, currency, payment_date: date, comment: comment.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(`Оплата не сохранилась: ${error.message}`); return; }
    toast.success("Оплата добавлена");
    setAdding(false); setAmount(""); setComment("");
    onChanged();
    reload();
  }

  async function remove(p: Payment) {
    if (!confirm(`Удалить оплату ${fmtMoney(p.amount)} ${p.currency} от ${formatDMY(p.payment_date)}?`)) return;
    setBusy(true);
    // RLS молча пропускает чужое удаление (0 строк) — проверяем, что строка ушла.
    const { data, error } = await sbLoose().from("deal_upstream_purchase_payments").delete().eq("id", p.id).select("id");
    setBusy(false);
    if (error) { toast.error(`Не удалилось: ${error.message}`); return; }
    if (!data || data.length === 0) { toast.error("Удалять оплаты может только администратор"); return; }
    toast.success("Оплата удалена");
    onChanged();
    reload();
  }

  return (
    <div className="space-y-2 border-t border-stone-200 pt-2">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-[12px] font-medium text-stone-700">Оплаты первичному поставщику</span>
        {totals.length > 0 ? (
          <span className="text-[12px] text-stone-600">
            Итого:{" "}
            {totals.map((t, i) => (
              <span key={t.currency} className="font-mono tabular-nums">
                {i > 0 ? "; " : ""}{fmtMoney(t.paid_amount)} {t.currency}
              </span>
            ))}
            {" · "}последняя {formatDMY(totals.map((t) => t.last_payment_date).sort().at(-1) ?? "")}
          </span>
        ) : (
          <span className="text-[12px] text-stone-500">Оплат нет.</span>
        )}
        {dealCount > 1 && (
          <span className="text-[11px] text-stone-400">оплата общая для {dealCount} сделок закупки</span>
        )}
      </div>

      {payments.length > 0 && (
        <table className="text-[12px]">
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-stone-100">
                <td className="pr-4 py-0.5 font-mono text-stone-600">{formatDMY(p.payment_date)}</td>
                <td className="pr-4 py-0.5 text-right font-mono tabular-nums text-stone-800">{fmtMoney(p.amount)} {p.currency}</td>
                <td className="pr-4 py-0.5 text-stone-500">{p.comment ?? ""}</td>
                <td className="py-0.5">
                  {canWrite && isAdmin && (
                    <button type="button" disabled={busy} onClick={() => void remove(p)}
                      className="rounded p-1 text-stone-300 hover:text-red-500 hover:bg-red-50" title="Удалить оплату">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canWrite && !adding && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />Добавить оплату
        </Button>
      )}
      {canWrite && adding && (
        <form onSubmit={(e) => { e.preventDefault(); void add(); }} className="flex flex-wrap items-end gap-2">
          <div>
            <span className="text-[11px] text-stone-400 block">Сумма оплаты</span>
            <Input className="h-8 w-36 text-[13px] font-mono tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
          <div>
            <span className="text-[11px] text-stone-400 block">Валюта</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}
              className="h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer">
              {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
            </select>
          </div>
          <div>
            <span className="text-[11px] text-stone-400 block">Дата оплаты</span>
            <Input type="date" className="h-8 w-40 text-[13px]" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="min-w-[180px] flex-1">
            <span className="text-[11px] text-stone-400 block">Комментарий</span>
            <Input className="h-8 text-[13px]" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setAdding(false)}>Отмена</Button>
          <Button type="submit" size="sm" disabled={busy}>{busy ? "Сохранение..." : "Сохранить"}</Button>
        </form>
      )}
    </div>
  );
}
