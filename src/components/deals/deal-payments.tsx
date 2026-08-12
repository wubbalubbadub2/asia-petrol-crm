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
import { invalidateDealBundle } from "@/lib/hooks/use-deal-bundle";
import { invalidateDeal, invalidateDealPayments } from "@/lib/hooks/use-deals";
import { formatDMY } from "@/lib/format";

type PaymentType = "payment" | "refund" | "offset";

type Payment = {
  id: string;
  side: "supplier" | "buyer";
  amount: number;
  payment_date: string | null;
  description: string | null;
  currency: string | null;
  payment_type: PaymentType;
  // Взаимозачёт (00145).
  offset_kind: string | null;
  counterparty_deal_id: string | null;
  mirror_of: string | null;
};

// Вклад строки в нетто оплат: возврат (историческая строка) вычитается,
// оплата и взаимозачёт хранят знак в самой сумме.
function signedAmount(p: Payment): number {
  // Возврат — историческая строка, хранится положительным и вычитается.
  // Оплата и взаимозачёт хранят знак в самой сумме.
  return p.payment_type === "refund" ? -p.amount : p.amount;
}

// Клиент 2026-08-12: тип оплаты убран. Возврат пишется той же оплатой
// со знаком минус, взаимозачёт — отдельная сущность со своим знаком.
// 'refund' остаётся только у исторических строк.
const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  payment: "Оплата",
  refund: "Возврат",
  offset: "Взаимозачёт",
};

const OFFSET_KIND_LABELS: Record<string, string> = {
  bilateral: "2-х сторонний",
  trilateral: "3-х сторонний",
};

function formatMoney(val: number): string {
  return val.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  const isMinus = p.payment_type === "refund" || p.amount < 0;
  return (
    <div className={`flex items-center gap-2 rounded px-2 py-1 text-[11px] ${isMinus ? "bg-red-50/60" : "bg-stone-50"}`}>
      {/* Тип записи больше не переключается: он задаётся кнопкой
          добавления. У взаимозачёта рядом показываем вид и встречную
          сделку, если она выбрана. */}
      <span
        className={`shrink-0 rounded px-1 text-[10px] ${
          p.payment_type === "offset" ? "bg-sky-100 text-sky-700"
            : isMinus ? "text-red-600 font-medium" : "text-stone-500"
        }`}
        title={p.payment_type === "offset" && p.offset_kind ? OFFSET_KIND_LABELS[p.offset_kind] : "Тип записи"}
      >
        {PAYMENT_TYPE_LABELS[p.payment_type]}
        {p.payment_type === "offset" && p.offset_kind ? ` · ${OFFSET_KIND_LABELS[p.offset_kind]}` : ""}
      </span>
      {p.mirror_of && (
        <span className="shrink-0 rounded bg-stone-200 px-1 text-[9px] text-stone-600" title="Создан автоматически встречным взаимозачётом другой сделки. Правится там.">
          зеркало
        </span>
      )}
      {/* Date */}
      {!editDate ? (
        <button
          onClick={() => { setDateLv((p.payment_date ?? "").split("T")[0]); setEditDate(true); }}
          className="text-stone-500 w-20 text-left hover:bg-amber-50 rounded px-1 cursor-text"
        >
          {formatDMY(p.payment_date)}
        </button>
      ) : (
        <input
          autoFocus type="date" value={dateLv}
          onChange={(e) => setDateLv(e.target.value)}
          onBlur={() => {
            setEditDate(false);
            if (dateLv && dateLv !== (p.payment_date ?? "").split("T")[0]) onUpdate(p.id, { payment_date: dateLv });
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditDate(false); }}
          className="w-28 border border-amber-300 rounded px-1 py-0 text-[11px] bg-amber-50/50 focus:outline-none"
        />
      )}
      {/* Amount */}
      {!editAmount ? (
        <button
          onClick={() => { setAmountLv(String(p.amount)); setEditAmount(true); }}
          className={`font-mono tabular-nums font-medium flex-1 text-left hover:bg-amber-50 rounded px-1 cursor-text ${isMinus ? "text-red-700" : "text-stone-800"}`}
        >
          {p.payment_type === "refund" ? "−" : ""}{formatMoney(p.amount)} {sym}
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

// Объявлен на уровне модуля, а не внутри DealPayments: компонент,
// созданный во время рендера, пересоздаётся на каждой перерисовке и
// теряет состояние. Замыкания на родителя заменены пропсами.
function PaymentList({ items, side, label, dealCurrency, onAdd, onUpdate, onDelete }: {
  items: Payment[];
  side: "supplier" | "buyer";
  label: string;
  dealCurrency: string;
  onAdd: (side: "supplier" | "buyer", kind: "payment" | "offset") => void;
  onUpdate: (id: string, patch: Partial<Payment>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  // Sum per-currency so mixed-currency lists make sense. Refunds
  // subtract — so the displayed total reflects what the rollup writes
  // to deals.supplier_payment / buyer_payment.
  const totals = new Map<string, number>();
  for (const p of items) {
    const code = p.currency ?? dealCurrency;
    totals.set(code, (totals.get(code) ?? 0) + signedAmount(p));
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[12px] font-medium text-stone-600">{label}</h4>
        <div className="flex gap-1">
          {/* Клиент 2026-08-12: две кнопки вместо выбора типа. */}
          <Button size="sm" variant="outline" onClick={() => onAdd(side, "payment")} className="h-6 px-2 text-[10px]">
            <Plus className="mr-1 h-3 w-3" /> Оплата
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAdd(side, "offset")} className="h-6 px-2 text-[10px]">
            <Plus className="mr-1 h-3 w-3" /> Взаимозачёт
          </Button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-stone-400">Нет оплат</p>
      ) : (
        <div className="space-y-1">
          {items.map((p) => (
            <PaymentRow key={p.id} p={p} dealCurrency={dealCurrency} onUpdate={onUpdate} onDelete={onDelete} />
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
  const [newType, setNewType] = useState<PaymentType>("payment");
  // Взаимозачёт (00145): вид и встречная сделка.
  const [newOffsetKind, setNewOffsetKind] = useState<"bilateral" | "trilateral">("trilateral");
  const [newCounterparty, setNewCounterparty] = useState("");
  const [dealOpts, setDealOpts] = useState<{ id: string; deal_code: string | null }[]>([]);

  async function loadPayments() {
    setLoading(true);
    const { data } = await supabaseRef.current
      .from("deal_payments")
      .select("*")
      .eq("deal_id", dealId)
      .order("payment_date", { ascending: true });
    // Migration 00051 introduces payment_type; tolerate older rows that
    // predate it by defaulting to 'payment'.
    // database.ts снимается с прода и колонок 00145 ещё не знает —
    // тот же приём, что в use-registry.ts. Убрать после `npm run types:db`.
    setPayments(((data ?? []) as unknown as Array<Omit<Payment, "payment_type"> & { payment_type?: PaymentType }>).map((r) => ({ ...r, payment_type: r.payment_type ?? "payment" })));
    setLoading(false);
  }

  useEffect(() => { loadPayments(); }, [dealId]);

  // After any payment write, the AFTER INSERT/UPDATE/DELETE trigger on
  // deal_payments recomputes the deal's supplier_payment / buyer_payment
  // rollup column. The local payments list reloads itself via
  // loadPayments(), but the parent's deal-bundle (used by the per-deal
  // header rollup cells) was holding the pre-write total. Same for the
  // passport-table popover payment cache. Invalidate them all so the
  // operator's «нужно постоянно обновлять страницу» complaint goes away.
  function notifyDealCachesAfterPaymentWrite() {
    invalidateDealPayments(dealId);
    invalidateDealBundle(dealId);
    invalidateDeal(dealId);
  }

  // Список сделок для выбора встречной — только при двустороннем.
  useEffect(() => {
    if (newType !== "offset" || newOffsetKind !== "bilateral" || dealOpts.length > 0) return;
    supabaseRef.current
      .from("deals")
      .select("id, deal_code")
      .eq("is_archived", false)
      .neq("id", dealId)
      .order("deal_code", { ascending: false })
      .limit(1000)
      .then(({ data }) => setDealOpts((data ?? []) as { id: string; deal_code: string | null }[]));
  }, [newType, newOffsetKind, dealOpts.length, dealId]);

  function openAddForm(s2: "supplier" | "buyer", kind: "payment" | "offset") {
    setNewType(kind);
    setAddingSide(s2);
  }

  async function addPayment() {
    const isOffset = newType === "offset";
    // У взаимозачёта даты нет (клиент 2026-08-12), у оплаты она обязательна.
    if (!addingSide || !newAmount || (!isOffset && !newDate)) return;
    if (isOffset && newOffsetKind === "bilateral" && !newCounterparty) {
      toast.error("Выберите встречную сделку");
      return;
    }
    // database.ts не знает колонок 00145 и считает payment_date
    // обязательной — вставляем через нетипизированный доступ, как в
    // use-registry.ts. Убрать после `npm run types:db`.
    const insertRow = supabaseRef.current.from("deal_payments") as unknown as {
      insert: (v: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
    };
    const { error } = await insertRow.insert({
      deal_id: dealId,
      side: addingSide,
      amount: parseFloat(newAmount),
      payment_date: isOffset ? null : newDate,
      description: newDesc || null,
      currency: newCurrency || null,
      payment_type: newType,
      offset_kind: isOffset ? newOffsetKind : null,
      counterparty_deal_id: isOffset && newOffsetKind === "bilateral" ? newCounterparty : null,
      // database.ts не знает колонок 00145 и требует payment_date —
      // приводим через unknown, как в use-registry.ts. Убрать после
      // `npm run types:db`.
    });
    if (error) { toast.error(`Ошибка: ${error.message}`); return; }
    setAddingSide(null);
    setNewAmount("");
    setNewDesc("");
    setNewCurrency("");
    setNewType("payment");
    setNewOffsetKind("trilateral");
    setNewCounterparty("");
    await loadPayments();
    notifyDealCachesAfterPaymentWrite();
  }

  async function deletePayment(id: string) {
    await supabaseRef.current.from("deal_payments").delete().eq("id", id);
    await loadPayments();
    notifyDealCachesAfterPaymentWrite();
  }

  async function updatePayment(id: string, patch: Partial<Payment>) {
    const { error } = await supabaseRef.current.from("deal_payments")
      .update(patch as Record<string, unknown>).eq("id", id);
    if (error) { toast.error(`Ошибка: ${error.message}`); return; }
    await loadPayments();
    notifyDealCachesAfterPaymentWrite();
  }

  const filteredPayments = side ? payments.filter((p) => p.side === side) : payments;
  const supplierPayments = payments.filter((p) => p.side === "supplier");
  const buyerPayments = payments.filter((p) => p.side === "buyer");


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
          <PaymentList items={filteredPayments} side={side} label={sideLabel} dealCurrency={dealCurrency} onAdd={openAddForm} onUpdate={updatePayment} onDelete={deletePayment} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PaymentList items={supplierPayments} side="supplier" label="Оплата поставщику" dealCurrency={dealCurrency} onAdd={openAddForm} onUpdate={updatePayment} onDelete={deletePayment} />
            <PaymentList items={buyerPayments} side="buyer" label="Оплата от покупателя" dealCurrency={dealCurrency} onAdd={openAddForm} onUpdate={updatePayment} onDelete={deletePayment} />
          </div>
        )}

        {/* Add payment form */}
        {addingSide && (
          <div className={`mt-3 rounded-md border p-3 ${newType === "offset" ? "border-sky-200 bg-sky-50/30" : "border-amber-200 bg-amber-50/30"}`}>
            <p className="text-[12px] font-medium text-stone-700 mb-2">
              {newType === "offset" ? "Новый взаимозачёт" : "Новая оплата"} ({addingSide === "supplier" ? "поставщику" : "от покупателя"})
            </p>
            <div className="flex flex-wrap items-end gap-2">
              {/* Тип не выбирается — он задан кнопкой. У взаимозачёта
                  вместо него вид и встречная сделка. */}
              {newType === "offset" && (
                <div className="w-32">
                  <Label className="text-[10px]">Вид</Label>
                  <select
                    value={newOffsetKind}
                    onChange={(e) => {
                      const v = e.target.value as "bilateral" | "trilateral";
                      setNewOffsetKind(v);
                      if (v !== "bilateral") setNewCounterparty("");
                    }}
                    className="h-7 w-full cursor-pointer rounded border border-stone-200 bg-white px-1 text-[12px] focus:border-amber-400 focus:outline-none"
                  >
                    <option value="bilateral">{OFFSET_KIND_LABELS.bilateral}</option>
                    <option value="trilateral">{OFFSET_KIND_LABELS.trilateral}</option>
                  </select>
                </div>
              )}
              {newType === "offset" && newOffsetKind === "bilateral" && (
                <div className="w-40">
                  <Label className="text-[10px]">Встречная сделка</Label>
                  <select
                    value={newCounterparty}
                    onChange={(e) => setNewCounterparty(e.target.value)}
                    className="h-7 w-full cursor-pointer rounded border border-stone-200 bg-white px-1 text-[12px] focus:border-amber-400 focus:outline-none"
                    title="В выбранной сделке появится встречный взаимозачёт с противоположным знаком"
                  >
                    <option value="">— выберите —</option>
                    {dealOpts.map((d) => <option key={d.id} value={d.id}>{d.deal_code ?? d.id.slice(0, 8)}</option>)}
                  </select>
                </div>
              )}
              <div className="w-28">
                <Label className="text-[10px]">Сумма</Label>
                <Input type="number" step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)}
                       placeholder={newType === "offset" ? "со знаком" : "минус = возврат"}
                       className="h-7 font-mono text-[12px]" />
              </div>
              <div className="w-24">
                <Label className="text-[10px]">Валюта</Label>
                <select value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)} className="h-7 w-full cursor-pointer rounded border border-stone-200 bg-white px-1 text-[12px] focus:border-amber-400 focus:outline-none">
                  <option value="">{dealCurrency} (сделка)</option>
                  {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              {newType !== "offset" && (
                <div className="w-28">
                  <Label className="text-[10px]">Дата</Label>
                  <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-7 text-[12px]" />
                </div>
              )}
              <div className="min-w-[140px] flex-1">
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
