"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

type Payment = {
  id: string;
  side: "supplier" | "buyer";
  amount: number;
  payment_date: string;
  description: string | null;
};

function formatMoney(val: number): string {
  return val.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export function DealPayments({ dealId, currencySymbol, side }: { dealId: string; currencySymbol: string; side?: "supplier" | "buyer" }) {
  const supabaseRef = useRef(createClient());
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingSide, setAddingSide] = useState<"supplier" | "buyer" | null>(null);
  const [newAmount, setNewAmount] = useState("");
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [newDesc, setNewDesc] = useState("");

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
    });
    if (error) { toast.error(`Ошибка: ${error.message}`); return; }
    setAddingSide(null);
    setNewAmount("");
    setNewDesc("");
    await loadPayments();
  }

  async function deletePayment(id: string) {
    await supabaseRef.current.from("deal_payments").delete().eq("id", id);
    await loadPayments();
  }

  const filteredPayments = side ? payments.filter((p) => p.side === side) : payments;
  const supplierPayments = payments.filter((p) => p.side === "supplier");
  const buyerPayments = payments.filter((p) => p.side === "buyer");

  function PaymentList({ items, side, label }: { items: Payment[]; side: "supplier" | "buyer"; label: string }) {
    const total = items.reduce((s, p) => s + p.amount, 0);
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
              <div key={p.id} className="flex items-center gap-2 rounded bg-stone-50 px-2 py-1 text-[11px]">
                <span className="text-stone-500 w-20">{new Date(p.payment_date).toLocaleDateString("ru-RU")}</span>
                <span className="font-mono tabular-nums font-medium text-stone-800 flex-1">{formatMoney(p.amount)} {currencySymbol}</span>
                {p.description && <span className="text-stone-400 truncate max-w-[100px]">{p.description}</span>}
                <button onClick={() => deletePayment(p.id)} className="text-stone-300 hover:text-red-500 transition-colors">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 px-2 py-1 text-[11px] border-t border-stone-200">
              <span className="text-stone-500 w-20 font-medium">Итого:</span>
              <span className="font-mono tabular-nums font-bold text-stone-900">{formatMoney(total)} {currencySymbol}</span>
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
              <div className="w-32">
                <Label className="text-[10px]">Сумма</Label>
                <Input type="number" step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} className="h-7 text-[12px] font-mono" />
              </div>
              <div className="w-28">
                <Label className="text-[10px]">Дата</Label>
                <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-7 text-[12px]" />
              </div>
              <div className="flex-1">
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
