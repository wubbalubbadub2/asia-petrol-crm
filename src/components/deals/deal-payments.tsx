"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { CURRENCIES, currencySymbol } from "@/lib/constants/currencies";

type Payment = {
  id: string;
  side: "supplier" | "buyer";
  amount: number;
  payment_date: string;
  description: string | null;
  currency: string | null;
};

function formatMoney(val: number): string {
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

// Single payment row with inline editable date/amount/description/currency
function PaymentRow({
  p, dealCurrency, onUpdate, onDelete,
}: {
  p: Payment;
  dealCurrency: string;
  onUpdate: (id: string, patch: Partial<Payment>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const effectiveCur = p.currency ?? dealCurrency;
  const sym = currencySymbol(effectiveCur);
  const [editDate, setEditDate] = useState(false);
  const [dateLv, setDateLv] = useState("");
  const [editAmount, setEditAmount] = useState(false);
  const [amountLv, setAmountLv] = useState("");
  const [editDesc, setEditDesc] = useState(false);
  const [descLv, setDescLv] = useState("");

  return (
    <div className="flex items-center gap-2 rounded bg-stone-50 px-2 py-1 text-[11px]">
      {/* Date */}
      {!editDate ? (
        <button
          onClick={() => { setDateLv(p.payment_date.split("T")[0]); setEditDate(true); }}
          className="text-stone-500 w-20 text-left hover:bg-amber-50 rounded px-1 cursor-text"
        >
          {new Date(p.payment_date).toLocaleDateString("ru-RU")}
        </button>
      ) : (
        <input
          autoFocus type="date" value={dateLv}
          onChange={(e) => setDateLv(e.target.value)}
          onBlur={() => {
            setEditDate(false);
            if (dateLv && dateLv !== p.payment_date.split("T")[0]) onUpdate(p.id, { payment_date: dateLv });
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditDate(false); }}
          className="w-28 border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none"
        />
      )}
      {/* Amount */}
      {!editAmount ? (
        <button
          onClick={() => { setAmountLv(String(p.amount)); setEditAmount(true); }}
          className="font-mono tabular-nums font-medium text-stone-800 flex-1 text-left hover:bg-amber-50 rounded px-1 cursor-text"
        >
          {formatMoney(p.amount)} {sym}
        </button>
      ) : (
        <input
          autoFocus type="number" step="0.01" value={amountLv}
          onChange={(e) => setAmountLv(e.target.value)}
          onBlur={() => {
            setEditAmount(false);
            const n = amountLv.trim() === "" ? null : parseFloat(amountLv.replace(",", "."));
            if (n != null && n !== p.amount) onUpdate(p.id, { amount: n });
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditAmount(false); }}
          className="flex-1 border border-amber-300 rounded px-1 py-0 text-[11px] font-mono bg-amber-50/50 focus:outline-none"
        />
      )}
      {/* Description */}
      {!editDesc ? (
        <button
          onClick={() => { setDescLv(p.description ?? ""); setEditDesc(true); }}
          className="text-stone-400 truncate max-w-[140px] text-left hover:bg-amber-50 rounded px-1 cursor-text"
        >
          {p.description || <span className="text-stone-300">комментарий…</span>}
        </button>
      ) : (
        <input
          autoFocus value={descLv}
          onChange={(e) => setDescLv(e.target.value)}
          onBlur={() => {
            setEditDesc(false);
            const nv = descLv.trim() || null;
            if (nv !== p.description) onUpdate(p.id, { description: nv });
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditDesc(false); }}
          className="w-36 border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none"
        />
      )}
      {/* Currency override */}
      <select
        value={p.currency ?? ""}
        onChange={(e) => {
          const nv = e.target.value || null;
          if (nv !== (p.currency ?? null)) onUpdate(p.id, { currency: nv });
        }}
        className="h-5 text-[10px] border border-transparent rounded bg-transparent hover:bg-amber-50 px-0.5 cursor-pointer focus:outline-none focus:border-amber-300"
        title="Валюта оплаты (пусто — как в сделке)"
      >
        <option value="">{dealCurrency} (сделка)</option>
        {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <button onClick={() => onDelete(p.id)} className="text-stone-300 hover:text-red-500 transition-colors">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

export function DealPayments({ dealId, currencySymbol: dealCurrencySymbol, side }: { dealId: string; currencySymbol: string; side?: "supplier" | "buyer" }) {
  // The deal-level currency code (USD / KZT / ...) is derived from the symbol we were given.
  // Find the code whose symbol matches; fall back to USD.
  const dealCurrency = CURRENCIES.find((c) => c.symbol === dealCurrencySymbol)?.value ?? "USD";
  const supabaseRef = useRef(createClient());
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingSide, setAddingSide] = useState<"supplier" | "buyer" | null>(null);
  const [newAmount, setNewAmount] = useState("");
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [newDesc, setNewDesc] = useState("");
  const [newCurrency, setNewCurrency] = useState("");  // empty = inherit deal currency

  useEffect(() => { loadPayments(); }, [dealId]);

  async function loadPayments() {
    setLoading(true);
    const { data } = await supabaseRef.current
      .from("deal_payments")
      .select("*")
      .eq("deal_id", dealId)
      .order("payment_date", { ascending: true });
    setPayments((data ?? []) as Payment[]);
    setLoading(false);
  }

  async function addPayment() {
    if (!addingSide || !newAmount || !newDate) return;
    const { error } = await supabaseRef.current.from("deal_payments").insert({
      deal_id: dealId,
      side: addingSide,
      amount: parseFloat(newAmount),
      payment_date: newDate,
      description: newDesc || null,
      currency: newCurrency || null,
    });
    if (error) { toast.error(`Ошибка: ${error.message}`); return; }
    setAddingSide(null);
    setNewAmount("");
    setNewDesc("");
    setNewCurrency("");
    await loadPayments();
  }

  async function deletePayment(id: string) {
    await supabaseRef.current.from("deal_payments").delete().eq("id", id);
    await loadPayments();
  }

  async function updatePayment(id: string, patch: Partial<Payment>) {
    const { error } = await supabaseRef.current.from("deal_payments").update(patch).eq("id", id);
    if (error) { toast.error(`Ошибка: ${error.message}`); return; }
    await loadPayments();
  }

  const filteredPayments = side ? payments.filter((p) => p.side === side) : payments;
  const supplierPayments = payments.filter((p) => p.side === "supplier");
  const buyerPayments = payments.filter((p) => p.side === "buyer");

  function PaymentList({ items, side, label }: { items: Payment[]; side: "supplier" | "buyer"; label: string }) {
    // Sum per-currency so mixed-currency lists make sense.
    const totals = new Map<string, number>();
    for (const p of items) {
      const code = p.currency ?? dealCurrency;
      totals.set(code, (totals.get(code) ?? 0) + p.amount);
    }
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[12px] font-medium text-stone-600">{label}</h4>
          <Button size="sm" variant="outline" onClick={() => setAddingSide(side)} className="h-6 text-[10px] px-2">
            <Plus className="h-3 w-3 mr-1" /> Оплата
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="text-[11px] text-stone-400">Нет оплат</p>
        ) : (
          <div className="space-y-1">
            {items.map((p) => (
              <PaymentRow key={p.id} p={p} dealCurrency={dealCurrency} onUpdate={updatePayment} onDelete={deletePayment} />
            ))}
            <div className="flex items-center gap-2 px-2 py-1 text-[11px] border-t border-stone-200">
              <span className="text-stone-500 w-20 font-medium">Итого:</span>
              <span className="flex flex-wrap gap-x-3 font-mono tabular-nums font-bold text-stone-900">
                {[...totals.entries()].map(([code, v]) => (
                  <span key={code}>{formatMoney(v)} {currencySymbol(code)}</span>
                ))}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  const sideLabel = side === "supplier" ? "Оплаты поставщику" : side === "buyer" ? "Оплаты от покупателя" : "Оплаты";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[14px]">{sideLabel}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-[11px] text-stone-400">Загрузка...</p>
        ) : side ? (
          <PaymentList items={filteredPayments} side={side} label={sideLabel} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PaymentList items={supplierPayments} side="supplier" label="Оплата поставщику" />
            <PaymentList items={buyerPayments} side="buyer" label="Оплата от покупателя" />
          </div>
        )}

        {/* Add payment form */}
        {addingSide && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50/30 p-3">
            <p className="text-[12px] font-medium text-stone-700 mb-2">
              Новая оплата ({addingSide === "supplier" ? "поставщику" : "от покупателя"})
            </p>
            <div className="flex gap-2 items-end">
              <div className="w-28">
                <Label className="text-[10px]">Сумма</Label>
                <Input type="number" step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} className="h-7 text-[12px] font-mono" />
              </div>
              <div className="w-24">
                <Label className="text-[10px]">Валюта</Label>
                <select value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)} className="w-full h-7 rounded border border-stone-200 bg-white px-1 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer">
                  <option value="">{dealCurrency} (сделка)</option>
                  {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="w-28">
                <Label className="text-[10px]">Дата</Label>
                <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-7 text-[12px]" />
              </div>
              <div className="flex-1 min-w-[140px]">
                <Label className="text-[10px]">Описание</Label>
                <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="комментарий" className="h-7 text-[12px]" />
              </div>
              <Button size="sm" onClick={addPayment} className="h-7 text-[11px]">Добавить</Button>
              <Button size="sm" variant="outline" onClick={() => setAddingSide(null)} className="h-7 text-[11px]">Отмена</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
